import {
    AccountInfo,
    AuthenticationResult,
    BrowserCacheLocation,
    Configuration,
    InteractionRequiredAuthError,
    PopupRequest,
    PublicClientApplication,
    SilentRequest,
    SsoSilentRequest,
} from "@azure/msal-browser";
import { AppError, isAppError } from "../../utils/errors";
import { log } from "./redact";

/** The subset of PublicClientApplication we use. Lets tests supply a fake. */
export interface MsalClientLike {
    initialize(): Promise<void>;
    getAllAccounts(): AccountInfo[];
    getActiveAccount(): AccountInfo | null;
    setActiveAccount(account: AccountInfo | null): void;
    acquireTokenSilent(request: SilentRequest): Promise<AuthenticationResult>;
    ssoSilent(request: SsoSilentRequest): Promise<AuthenticationResult>;
    acquireTokenPopup(request: PopupRequest): Promise<AuthenticationResult>;
}

export interface AuthSettings {
    clientId: string;
    tenantId: string;
    /** D365 org URL. The SPA platform redirect URI registered on the app. */
    redirectUri: string;
    /** The signed-in user's UPN (or a function resolving it lazily). */
    loginHint?: LoginHint;
}

/** Something that hands out bearer tokens for a scope. Services depend on this, not on MSAL. */
export type TokenProvider = (scope: string) => Promise<string>;

export type LoginHint = string | (() => Promise<string | undefined>);

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validateAuthSettings(s: Partial<AuthSettings>): string[] {
    const problems: string[] = [];
    if (!s.clientId || !GUID_RE.test(s.clientId.trim())) problems.push("clientId must be a GUID.");
    if (!s.tenantId || !GUID_RE.test(s.tenantId.trim())) problems.push("tenantId must be a GUID.");
    return problems;
}

export function buildMsalConfig(s: AuthSettings): Configuration {
    return {
        auth: {
            clientId: s.clientId.trim(),
            authority: `https://login.microsoftonline.com/${s.tenantId.trim()}`,
            redirectUri: s.redirectUri,
            // The redirect URI is the D365 org URL. Never navigate the form away.
            navigateToLoginRequestUrl: false,
        },
        cache: {
            cacheLocation: BrowserCacheLocation.SessionStorage,
        },
        system: {
            loggerOptions: {
                // MSAL's own logging can include PII / URLs with codes. Keep it off.
                piiLoggingEnabled: false,
                loggerCallback: () => undefined,
            },
        },
    };
}

const POPUP_BLOCKED_CODES = new Set(["popup_window_error", "empty_window_error"]);
const CANCELLED_CODES = new Set(["user_cancelled"]);

/** Map MSAL interactive errors onto our typed errors. */
export function mapInteractiveError(e: unknown): AppError {
    if (isAppError(e)) return e;
    const code = (e as { errorCode?: string })?.errorCode ?? "";
    if (POPUP_BLOCKED_CODES.has(code)) {
        return new AppError(
            "popup-blocked",
            "The sign-in popup was blocked. Allow popups for this Dynamics 365 site, then select Sign in.",
        );
    }
    if (CANCELLED_CODES.has(code)) {
        return new AppError("auth-cancelled", "Sign-in was cancelled.");
    }
    if (e instanceof InteractionRequiredAuthError || code === "interaction_required") {
        return new AppError("auth-required", "Sign-in is required.");
    }
    return new AppError("auth-failed", `Sign-in failed (${code || "unknown error"}).`);
}

function isInteractionRequired(e: unknown): boolean {
    if (e instanceof InteractionRequiredAuthError) return true;
    const code = (e as { errorCode?: string })?.errorCode;
    return (
        code === "interaction_required" ||
        code === "login_required" ||
        code === "consent_required" ||
        code === "no_account_error" ||
        code === "monitor_window_timeout" // ssoSilent iframe blocked / third-party cookies
    );
}

/**
 * One MSAL instance per control, created once. Token acquisition:
 *   acquireTokenSilent -> ssoSilent(loginHint) -> acquireTokenPopup
 *
 * The popup is attempted at most once per `getToken` call. If it fails,
 * the error surfaces as a typed state (popup-blocked / auth-required) and
 * the UI offers a "Sign in" button that calls `signInInteractive` from a
 * user click, which also keeps popup blockers happy. No retry loops.
 */
export class AuthService {
    private readonly client: MsalClientLike;
    private readonly hintSource?: LoginHint;
    private loginHint?: string;
    private hintPromise?: Promise<void>;
    private initPromise?: Promise<void>;
    private readonly inflight = new Map<string, Promise<string>>();
    /** Set once silent+popup failed; further calls fail fast until the user clicks Sign in. */
    private interactionNeeded = false;
    /** The scope that last needed interaction: what a "Sign in" click should request. */
    lastInteractiveScope?: string;

    constructor(client: MsalClientLike, loginHint?: LoginHint) {
        this.client = client;
        this.hintSource = loginHint;
    }

    static create(settings: AuthSettings): AuthService {
        const pca = new PublicClientApplication(buildMsalConfig(settings));
        return new AuthService(pca, settings.loginHint);
    }

    /** Bind to a TokenProvider for services. */
    readonly tokenProvider: TokenProvider = (scope) => this.getToken(scope);

    private resolveHint(): Promise<void> {
        if (!this.hintPromise) {
            const src = this.hintSource;
            this.hintPromise = (typeof src === "function" ? src() : Promise.resolve(src))
                .then((h) => {
                    this.loginHint = h?.trim() || undefined;
                })
                .catch(() => {
                    this.loginHint = undefined;
                });
        }
        return this.hintPromise;
    }

    private init(): Promise<void> {
        if (!this.initPromise) {
            this.initPromise = Promise.all([this.client.initialize(), this.resolveHint()]).then(() => undefined, (e) => {
                this.initPromise = undefined;
                throw mapInteractiveError(e);
            });
        }
        return this.initPromise;
    }

    private pickAccount(): AccountInfo | undefined {
        const active = this.client.getActiveAccount();
        if (active) return active;
        const all = this.client.getAllAccounts();
        if (this.loginHint) {
            const hint = this.loginHint.toLowerCase();
            const match = all.find((a) => a.username?.toLowerCase() === hint);
            if (match) return match;
        }
        return all.length === 1 ? all[0] : undefined;
    }

    private remember(result: AuthenticationResult): string {
        if (result.account) this.client.setActiveAccount(result.account);
        if (!result.accessToken) throw new AppError("auth-failed", "No access token was returned.");
        return result.accessToken;
    }

    /** Silent-only acquisition. Throws AppError("auth-required") if interaction is needed. */
    async getTokenSilent(scope: string): Promise<string> {
        await this.init();
        const scopes = [scope];
        const account = this.pickAccount();
        if (account) {
            try {
                return this.remember(await this.client.acquireTokenSilent({ scopes, account }));
            } catch (e) {
                if (!isInteractionRequired(e)) throw mapInteractiveError(e);
            }
        }
        if (this.loginHint) {
            try {
                return this.remember(await this.client.ssoSilent({ scopes, loginHint: this.loginHint }));
            } catch (e) {
                if (!isInteractionRequired(e)) {
                    log.warn("ssoSilent failed; interactive sign-in needed", e);
                }
            }
        }
        throw new AppError("auth-required", "Sign-in is required.");
    }

    async getToken(scope: string): Promise<string> {
        const existing = this.inflight.get(scope);
        if (existing) return existing;
        const p = this.acquire(scope).finally(() => this.inflight.delete(scope));
        this.inflight.set(scope, p);
        return p;
    }

    private async acquire(scope: string): Promise<string> {
        try {
            return await this.getTokenSilent(scope);
        } catch (e) {
            if (!isAppError(e, "auth-required")) throw e;
        }
        this.lastInteractiveScope = scope;
        if (this.interactionNeeded) {
            throw new AppError("auth-required", "Sign-in is required.");
        }
        try {
            return await this.popup(scope);
        } catch (e) {
            this.interactionNeeded = true;
            throw mapInteractiveError(e);
        }
    }

    /** Call from a user gesture (Sign in button). Clears the "interaction needed" latch on success. */
    async signInInteractive(scope: string): Promise<string> {
        await this.init();
        try {
            const token = await this.popup(scope);
            this.interactionNeeded = false;
            return token;
        } catch (e) {
            throw mapInteractiveError(e);
        }
    }

    private async popup(scope: string): Promise<string> {
        await this.init();
        const request: PopupRequest = { scopes: [scope], loginHint: this.loginHint };
        const account = this.pickAccount();
        if (account) request.account = account;
        return this.remember(await this.client.acquireTokenPopup(request));
    }
}
