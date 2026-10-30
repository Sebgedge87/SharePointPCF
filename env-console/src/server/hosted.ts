import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { AuthError, type TokenSource } from "../core/auth.js";
import { isValidTenant, normaliseEnvUrl, type PcxConfig } from "../core/config.js";

/** Settings for hosted mode, read from app settings (environment variables). */
export interface HostedSettings {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  /** Public address of the site, e.g. https://pcx-contoso.azurewebsites.net */
  publicUrl: string;
  /** Random secret used to protect the sign-in cookie. */
  sessionSecret: string;
  /** Optional Entra app role a user must hold (in addition to "assignment required"). */
  requiredRole?: string;
  /** Sessions end after this long without use. */
  idleMinutes: number;
  authority: string;
}

export class SettingsError extends Error {}

export function loadHostedSettings(env: NodeJS.ProcessEnv = process.env): HostedSettings {
  const need = (k: string) => {
    const v = env[k];
    if (!v) throw new SettingsError(`App setting ${k} is required in hosted mode`);
    return v;
  };
  const tenantId = need("PCX_TENANT_ID");
  if (!isValidTenant(tenantId)) throw new SettingsError("PCX_TENANT_ID must be a tenant GUID or domain");
  const clientId = need("PCX_CLIENT_ID");
  if (!/^[0-9a-f-]{36}$/i.test(clientId)) throw new SettingsError("PCX_CLIENT_ID must be the app registration's Application (client) ID");
  let publicUrl: URL;
  try {
    publicUrl = new URL(need("PCX_PUBLIC_URL"));
  } catch {
    throw new SettingsError("PCX_PUBLIC_URL must be a URL like https://pcx-contoso.azurewebsites.net");
  }
  const local = publicUrl.hostname === "localhost" || publicUrl.hostname === "127.0.0.1";
  if (publicUrl.protocol !== "https:" && !local) throw new SettingsError("PCX_PUBLIC_URL must use https");
  const sessionSecret = need("PCX_SESSION_SECRET");
  if (sessionSecret.length < 32) throw new SettingsError("PCX_SESSION_SECRET must be at least 32 characters");
  const idle = Number(env.PCX_SESSION_IDLE_MINUTES ?? 480);
  return {
    tenantId,
    clientId,
    clientSecret: need("PCX_CLIENT_SECRET"),
    publicUrl: publicUrl.origin,
    sessionSecret,
    requiredRole: env.PCX_REQUIRED_ROLE || undefined,
    idleMinutes: Number.isFinite(idle) && idle > 0 ? idle : 480,
    authority: (env.PCX_AUTHORITY || "https://login.microsoftonline.com").replace(/\/$/, "")
  };
}

// ------------------------------------------------------------------ small helpers

const b64url = (b: Buffer) => b.toString("base64url");

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function cookie(name: string, value: string, secure: boolean, maxAgeSec?: number): string {
  return [`${name}=${encodeURIComponent(value)}`, "Path=/", "HttpOnly", "SameSite=Lax", secure ? "Secure" : "", maxAgeSec !== undefined ? `Max-Age=${maxAgeSec}` : ""].filter(Boolean).join("; ");
}

/** AES-256-GCM seal/open for the short-lived sign-in cookie. */
export function seal(secret: string, data: unknown): string {
  const key = createHash("sha256").update(secret).digest();
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([c.update(JSON.stringify(data), "utf8"), c.final()]);
  return b64url(Buffer.concat([iv, c.getAuthTag(), ct]));
}

export function unseal<T>(secret: string, value: string): T | undefined {
  try {
    const raw = Buffer.from(value, "base64url");
    const key = createHash("sha256").update(secret).digest();
    const d = createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
    d.setAuthTag(raw.subarray(12, 28));
    return JSON.parse(Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString("utf8")) as T;
  } catch {
    return undefined;
  }
}

function decodeJwtPayload(jwt: string): Record<string, unknown> {
  const part = jwt.split(".")[1];
  if (!part) throw new Error("Malformed ID token");
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as Record<string, unknown>;
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Only same-site relative paths are allowed as a place to return to after sign-in. */
function safeReturnTo(v: string | null): string {
  return v && /^\/(?!\/)[A-Za-z0-9/_\-#?=&.%]*$/.test(v) ? v : "/";
}

// ------------------------------------------------------------------ sessions

interface CachedToken {
  token: string;
  expiresAt: number;
}

export interface Session {
  id: string;
  user: string;
  name: string;
  oid: string;
  refreshToken: string;
  tokens: Map<string, CachedToken>;
  lastSeen: number;
}

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ status: number; ok: boolean; text(): Promise<string> }>;

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  id_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

const NEEDS_LOGIN = /invalid_grant|interaction_required|login_required|consent_required/;

/**
 * Entra ID sign-in (authorization code + PKCE) and per-user tokens for each environment.
 * Each user's refresh token is exchanged for a token per Dataverse environment, so every
 * call runs as that user with their own security roles.
 */
export class HostedAuth {
  private readonly sessions = new Map<string, Session>();
  private readonly fetchImpl: FetchLike;
  private readonly now: () => number;
  readonly secure: boolean;

  constructor(
    readonly settings: HostedSettings,
    private readonly config: PcxConfig,
    opts: { fetchImpl?: FetchLike; now?: () => number } = {}
  ) {
    this.fetchImpl = opts.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
    this.now = opts.now ?? Date.now;
    this.secure = settings.publicUrl.startsWith("https:");
  }

  get redirectUri(): string {
    return `${this.settings.publicUrl}/auth/callback`;
  }

  private get tokenEndpoint(): string {
    return `${this.settings.authority}/${this.settings.tenantId}/oauth2/v2.0/token`;
  }

  /** The first environment's scope is asked for at sign-in; others are fetched with the refresh token. */
  private loginScope(): string {
    const first = this.config.environments[0];
    const resource = first ? first.url : "https://globaldisco.crm.dynamics.com";
    return `openid profile offline_access ${resource}/user_impersonation`;
  }

  // ---------------------------------------------------------------- routes

  /** Handles /auth/* routes. Returns true when it answered the request. */
  async route(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
    if (url.pathname === "/auth/login" && req.method === "GET") {
      const verifier = b64url(randomBytes(32));
      const state = b64url(randomBytes(16));
      const nonce = b64url(randomBytes(16));
      const flow = { state, verifier, nonce, returnTo: safeReturnTo(url.searchParams.get("returnTo")), exp: this.now() + 10 * 60_000 };
      const q = new URLSearchParams({
        client_id: this.settings.clientId,
        response_type: "code",
        redirect_uri: this.redirectUri,
        response_mode: "query",
        scope: this.loginScope(),
        state,
        nonce,
        code_challenge: b64url(createHash("sha256").update(verifier).digest()),
        code_challenge_method: "S256",
        prompt: "select_account"
      });
      res.writeHead(302, {
        Location: `${this.settings.authority}/${this.settings.tenantId}/oauth2/v2.0/authorize?${q}`,
        "Set-Cookie": cookie("pcx_flow", seal(this.settings.sessionSecret, flow), this.secure, 600),
        "Cache-Control": "no-store"
      });
      res.end();
      return true;
    }
    if (url.pathname === "/auth/callback" && req.method === "GET") {
      await this.callback(req, res, url);
      return true;
    }
    if (url.pathname === "/auth/logout") {
      const sid = parseCookies(req.headers.cookie).pcx_session;
      if (sid) this.sessions.delete(sid);
      const q = new URLSearchParams({ post_logout_redirect_uri: `${this.settings.publicUrl}/` });
      res.writeHead(302, {
        Location: `${this.settings.authority}/${this.settings.tenantId}/oauth2/v2.0/logout?${q}`,
        "Set-Cookie": cookie("pcx_session", "", this.secure, 0),
        "Cache-Control": "no-store"
      });
      res.end();
      return true;
    }
    return false;
  }

  private async callback(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const fail = (status: number, msg: string) => {
      res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "Set-Cookie": cookie("pcx_flow", "", this.secure, 0) });
      res.end(`Sign-in failed: ${msg}\n\nGo back to ${this.settings.publicUrl}/ and try again.`);
    };
    const err = url.searchParams.get("error");
    if (err) return fail(400, `${err} ${url.searchParams.get("error_description") ?? ""}`.trim().slice(0, 300));
    const flow = unseal<{ state: string; verifier: string; nonce: string; returnTo: string; exp: number }>(this.settings.sessionSecret, parseCookies(req.headers.cookie).pcx_flow ?? "");
    const state = url.searchParams.get("state") ?? "";
    const code = url.searchParams.get("code") ?? "";
    if (!flow || flow.exp < this.now() || !safeEqual(flow.state, state) || !code) return fail(400, "the sign-in request expired or did not match. Start again.");

    const t = await this.tokenRequest({
      grant_type: "authorization_code",
      code,
      redirect_uri: this.redirectUri,
      code_verifier: flow.verifier,
      scope: this.loginScope()
    });
    if (!t.access_token || !t.refresh_token || !t.id_token) return fail(502, t.error_description?.split("\n")[0] ?? t.error ?? "no tokens returned");

    // The ID token came straight from the token endpoint over TLS with our client secret,
    // so its claims are checked rather than its signature (OpenID Connect Core 3.1.3.7).
    const claims = decodeJwtPayload(t.id_token);
    if (claims.aud !== this.settings.clientId) return fail(400, "ID token was issued for another app");
    if (claims.nonce !== flow.nonce) return fail(400, "nonce mismatch");
    if (/^[0-9a-f-]{36}$/i.test(this.settings.tenantId) && claims.tid !== this.settings.tenantId) return fail(403, "your account is from a different tenant");
    const roles = Array.isArray(claims.roles) ? (claims.roles as string[]) : [];
    if (this.settings.requiredRole && !roles.includes(this.settings.requiredRole)) return fail(403, `you need the "${this.settings.requiredRole}" role for this app`);

    const session: Session = {
      id: b64url(randomBytes(32)),
      user: String(claims.preferred_username ?? claims.upn ?? claims.email ?? claims.oid ?? "unknown"),
      name: String(claims.name ?? claims.preferred_username ?? ""),
      oid: String(claims.oid ?? ""),
      refreshToken: t.refresh_token,
      tokens: new Map(),
      lastSeen: this.now()
    };
    const first = this.config.environments[0];
    if (first) session.tokens.set(first.url, { token: t.access_token, expiresAt: this.now() + (t.expires_in ?? 3600) * 1000 });
    this.sessions.set(session.id, session);
    res.writeHead(302, {
      Location: flow.returnTo,
      "Set-Cookie": [cookie("pcx_session", session.id, this.secure), cookie("pcx_flow", "", this.secure, 0)],
      "Cache-Control": "no-store"
    });
    res.end();
  }

  private async tokenRequest(params: Record<string, string>): Promise<TokenResponse> {
    const body = new URLSearchParams({ client_id: this.settings.clientId, client_secret: this.settings.clientSecret, ...params }).toString();
    const r = await this.fetchImpl(this.tokenEndpoint, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
    const text = await r.text();
    try {
      return JSON.parse(text) as TokenResponse;
    } catch {
      return { error: `HTTP ${r.status}` };
    }
  }

  // ---------------------------------------------------------------- sessions

  /** The signed-in session for this request, or undefined. */
  session(req: IncomingMessage): Session | undefined {
    const sid = parseCookies(req.headers.cookie).pcx_session;
    if (!sid) return undefined;
    const s = this.sessions.get(sid);
    if (!s) return undefined;
    if (this.now() - s.lastSeen > this.settings.idleMinutes * 60_000) {
      this.sessions.delete(sid);
      return undefined;
    }
    s.lastSeen = this.now();
    return s;
  }

  /** A token source that gets tokens as this user, one per environment. */
  tokensFor(s: Session): TokenSource {
    return {
      token: async (resource: string) => {
        const key = normaliseEnvUrl(resource);
        const hit = s.tokens.get(key);
        if (hit && hit.expiresAt - this.now() > 5 * 60_000) return hit.token;
        const t = await this.tokenRequest({ grant_type: "refresh_token", refresh_token: s.refreshToken, scope: `${key}/user_impersonation offline_access` });
        if (!t.access_token) {
          const msg = t.error_description?.split("\n")[0] ?? t.error ?? "token refresh failed";
          if (NEEDS_LOGIN.test(`${t.error} ${t.error_description}`)) {
            if (/consent/i.test(msg)) throw new AuthError(`Dataverse access has not been consented for this app: ${msg}`);
            throw new AuthError("Your sign-in expired. Sign in again.", true);
          }
          throw new AuthError(msg);
        }
        if (t.refresh_token) s.refreshToken = t.refresh_token;
        s.tokens.set(key, { token: t.access_token, expiresAt: this.now() + (t.expires_in ?? 3600) * 1000 });
        return t.access_token;
      }
    };
  }

  /** For tests and diagnostics. */
  get sessionCount(): number {
    return this.sessions.size;
  }
}
