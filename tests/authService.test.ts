import { InteractionRequiredAuthError } from "@azure/msal-browser";
import { AuthService, MsalClientLike, buildMsalConfig, validateAuthSettings } from "../src/services/auth/authService";
import { isAppError } from "../src/utils/errors";

const SCOPE = "https://contoso.sharepoint.com/.default";
const account = { username: "user@contoso.com", homeAccountId: "h", environment: "e", tenantId: "t", localAccountId: "l" };
const ok = (token: string) => ({ accessToken: token, account }) as never;

function fakeClient(overrides: Partial<MsalClientLike> = {}): jest.Mocked<MsalClientLike> {
    let active: unknown = null;
    return {
        initialize: jest.fn(async () => undefined),
        getAllAccounts: jest.fn(() => []),
        getActiveAccount: jest.fn(() => active as never),
        setActiveAccount: jest.fn((a) => {
            active = a;
        }),
        acquireTokenSilent: jest.fn(async () => ok("silent")),
        ssoSilent: jest.fn(async () => ok("sso")),
        acquireTokenPopup: jest.fn(async () => ok("popup")),
        ...overrides,
    } as jest.Mocked<MsalClientLike>;
}

const browserError = (errorCode: string) => Object.assign(new Error(errorCode), { errorCode });

describe("AuthService", () => {
    it("uses ssoSilent with the loginHint when no account is cached", async () => {
        const c = fakeClient();
        const auth = new AuthService(c, "user@contoso.com");
        await expect(auth.getToken(SCOPE)).resolves.toBe("sso");
        expect(c.acquireTokenSilent).not.toHaveBeenCalled();
        expect(c.ssoSilent).toHaveBeenCalledWith({ scopes: [SCOPE], loginHint: "user@contoso.com" });
        expect(c.acquireTokenPopup).not.toHaveBeenCalled();
    });

    it("prefers acquireTokenSilent once an account is known", async () => {
        const c = fakeClient({ getAllAccounts: jest.fn(() => [account as never]) });
        const auth = new AuthService(c, "USER@contoso.com");
        await expect(auth.getToken(SCOPE)).resolves.toBe("silent");
        expect(c.acquireTokenSilent).toHaveBeenCalledWith({ scopes: [SCOPE], account });
        expect(c.ssoSilent).not.toHaveBeenCalled();
    });

    it("falls back silent -> ssoSilent -> popup on interaction_required", async () => {
        const c = fakeClient({
            getAllAccounts: jest.fn(() => [account as never]),
            acquireTokenSilent: jest.fn(async () => {
                throw new InteractionRequiredAuthError("interaction_required");
            }),
            ssoSilent: jest.fn(async () => {
                throw new InteractionRequiredAuthError("login_required");
            }),
        });
        const auth = new AuthService(c, "user@contoso.com");
        await expect(auth.getToken(SCOPE)).resolves.toBe("popup");
        expect(c.acquireTokenPopup).toHaveBeenCalledTimes(1);
    });

    it("initializes MSAL once, and dedupes concurrent requests for a scope", async () => {
        const c = fakeClient();
        const auth = new AuthService(c, "u@c.com");
        await Promise.all([auth.getToken(SCOPE), auth.getToken(SCOPE), auth.getToken("https://graph.microsoft.com/TermStore.Read.All")]);
        expect(c.initialize).toHaveBeenCalledTimes(1);
        expect(c.ssoSilent).toHaveBeenCalledTimes(2);
    });

    it("maps a blocked popup to popup-blocked and does not loop", async () => {
        const c = fakeClient({
            ssoSilent: jest.fn(async () => {
                throw new InteractionRequiredAuthError("login_required");
            }),
            acquireTokenPopup: jest.fn(async () => {
                throw browserError("popup_window_error");
            }),
        });
        const auth = new AuthService(c, "u@c.com");
        await expect(auth.getToken(SCOPE)).rejects.toMatchObject({ kind: "popup-blocked" });
        // second call fails fast (auth-required) without another popup
        await expect(auth.getToken(SCOPE)).rejects.toMatchObject({ kind: "auth-required" });
        expect(c.acquireTokenPopup).toHaveBeenCalledTimes(1);
    });

    it("signInInteractive clears the latch", async () => {
        const popup = jest
            .fn()
            .mockRejectedValueOnce(browserError("user_cancelled"))
            .mockResolvedValueOnce(ok("popup2"));
        const c = fakeClient({
            ssoSilent: jest.fn(async () => {
                throw new InteractionRequiredAuthError("login_required");
            }),
            acquireTokenPopup: popup,
        });
        const auth = new AuthService(c, "u@c.com");
        await expect(auth.getToken(SCOPE)).rejects.toMatchObject({ kind: "auth-cancelled" });
        await expect(auth.signInInteractive(SCOPE)).resolves.toBe("popup2");
        expect(c.setActiveAccount).toHaveBeenCalledWith(account);
    });

    it("does not swallow non-interaction silent errors", async () => {
        const c = fakeClient({
            getAllAccounts: jest.fn(() => [account as never]),
            acquireTokenSilent: jest.fn(async () => {
                throw browserError("network_error");
            }),
        });
        const auth = new AuthService(c);
        const err = await auth.getToken(SCOPE).catch((e) => e);
        expect(isAppError(err, "auth-failed")).toBe(true);
        expect(c.acquireTokenPopup).not.toHaveBeenCalled();
    });
});

describe("auth config", () => {
    it("validates ids", () => {
        expect(validateAuthSettings({ clientId: "x", tenantId: "" })).toHaveLength(2);
        const g = "11111111-2222-3333-4444-555555555555";
        expect(validateAuthSettings({ clientId: g, tenantId: g })).toEqual([]);
    });
    it("builds a public-client config with sessionStorage and no secret", () => {
        const cfg = buildMsalConfig({ clientId: " cid ", tenantId: "tid", redirectUri: "https://org.crm.dynamics.com" });
        expect(cfg.auth.clientId).toBe("cid");
        expect(cfg.auth.authority).toBe("https://login.microsoftonline.com/tid");
        expect(cfg.cache?.cacheLocation).toBe("sessionStorage");
        expect(JSON.stringify(cfg)).not.toMatch(/secret/i);
    });
});
