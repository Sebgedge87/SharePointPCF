import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request } from "node:http";
import { startServer, type RunningServer } from "../src/server/index.js";
import { HostedAuth, loadHostedSettings, seal, unseal, SettingsError, type HostedSettings } from "../src/server/hosted.js";
import type { PcxConfig } from "../src/core/config.js";
import { DEV, PROD, fakeFetch } from "./helpers.js";

const TENANT = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const CLIENT = "11111111-2222-3333-4444-555555555555";
const config: PcxConfig = { auth: { provider: "azps" }, environments: [DEV, PROD] };

const jwt = (claims: Record<string, unknown>) => `e30.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.sig`;

// Fake Entra token endpoint.
let nonceSeen = "";
let idClaims: Record<string, unknown> = {};
const tokenCalls: URLSearchParams[] = [];
const idp = async (_url: string, init: { body: string }) => {
  const p = new URLSearchParams(init.body);
  tokenCalls.push(p);
  let body: unknown;
  if (p.get("grant_type") === "authorization_code") {
    body = { access_token: "at-dev", refresh_token: "rt-1", id_token: jwt({ ...idClaims, nonce: nonceSeen }), expires_in: 3600 };
  } else if (p.get("refresh_token") === "rt-revoked") {
    body = { error: "invalid_grant", error_description: "AADSTS700082: The refresh token has expired" };
  } else {
    const scope = p.get("scope") ?? "";
    body = { access_token: "at-" + (scope.includes("org.crm11") ? "prod" : "other"), refresh_token: "rt-2", expires_in: 3600 };
  }
  return { status: 200, ok: true, text: async () => JSON.stringify(body) };
};

// Fake Dataverse that records which token reached which environment.
const seenTokens: string[] = [];
const dv = fakeFetch((c) => {
  seenTokens.push(`${new URL(c.url).hostname} ${c.headers.Authorization}`);
  if (c.url.includes("/workflows")) return { body: { value: [{ workflowid: "99999999-9999-9999-9999-999999999999", name: "Flow A", statecode: 1 }] } };
  if (c.method === "PATCH") return { status: 204 };
  return { body: { value: [] } };
});

let srv: RunningServer;
let auth: HostedAuth;
let settings: HostedSettings;

before(async () => {
  process.env.PCX_ACTION_LOG = join(mkdtempSync(join(tmpdir(), "pcx-")), "actions.log");
  settings = loadHostedSettings({
    PCX_TENANT_ID: TENANT,
    PCX_CLIENT_ID: CLIENT,
    PCX_CLIENT_SECRET: "secret",
    PCX_PUBLIC_URL: "http://localhost:1", // port fixed below
    PCX_SESSION_SECRET: "s".repeat(40)
  });
  // Start on a random port, then point the public URL at it.
  auth = new HostedAuth(settings, config, { fetchImpl: idp as never });
  srv = await startServer({ config, port: 0, listenHost: "127.0.0.1", mode: { kind: "hosted", auth, clientOptions: { fetchImpl: dv.fn } } });
  settings.publicUrl = `http://localhost:${srv.port}`;
});
after(() => srv.close());

function call(path: string, o: { method?: string; cookie?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  return new Promise<{ status: number; body: any; headers: Record<string, any> }>((resolve, reject) => {
    const headers: Record<string, string> = { host: `localhost:${srv.port}`, ...(o.headers ?? {}) };
    if (o.cookie) headers.cookie = o.cookie;
    let data: string | undefined;
    if (o.body !== undefined) {
      data = JSON.stringify(o.body);
      headers["content-type"] = "application/json";
    }
    const req = request({ host: "127.0.0.1", port: srv.port, path, method: o.method ?? "GET", headers }, (res) => {
      let text = "";
      res.on("data", (d) => (text += d));
      res.on("end", () => {
        let body: unknown = text;
        try {
          body = JSON.parse(text);
        } catch {
          /* not json */
        }
        resolve({ status: res.statusCode!, body, headers: res.headers });
      });
    });
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

const cookieValue = (setCookie: string[] | undefined, name: string) => {
  const c = (setCookie ?? []).find((x) => x.startsWith(name + "="));
  return c ? decodeURIComponent(c.split(";")[0]!.slice(name.length + 1)) : "";
};

async function signIn(claims: Record<string, unknown>): Promise<{ status: number; cookie: string; body: unknown; location?: string }> {
  idClaims = claims;
  const start = await call("/auth/login?returnTo=%2F%23%2Fsolutions");
  const loc = new URL(start.headers.location);
  nonceSeen = loc.searchParams.get("nonce")!;
  const flow = cookieValue(start.headers["set-cookie"], "pcx_flow");
  const cb = await call(`/auth/callback?code=abc&state=${loc.searchParams.get("state")}`, { cookie: `pcx_flow=${encodeURIComponent(flow)}` });
  return { status: cb.status, cookie: `pcx_session=${cookieValue(cb.headers["set-cookie"], "pcx_session")}`, body: cb.body, location: cb.headers.location };
}

const goodClaims = { aud: CLIENT, tid: TENANT, oid: "o1", preferred_username: "sam@contoso.com", name: "Sam Admin" };

test("settings are validated", () => {
  assert.throws(() => loadHostedSettings({}), SettingsError);
  assert.throws(() => loadHostedSettings({ PCX_TENANT_ID: TENANT, PCX_CLIENT_ID: CLIENT, PCX_CLIENT_SECRET: "x", PCX_PUBLIC_URL: "http://pcx.example.com", PCX_SESSION_SECRET: "s".repeat(40) }), /https/);
  assert.throws(() => loadHostedSettings({ PCX_TENANT_ID: TENANT, PCX_CLIENT_ID: CLIENT, PCX_CLIENT_SECRET: "x", PCX_PUBLIC_URL: "https://pcx.example.com", PCX_SESSION_SECRET: "short" }), /32/);
});

test("sealed cookies cannot be read or changed without the secret", () => {
  const v = seal("a".repeat(40), { x: 1 });
  assert.deepEqual(unseal("a".repeat(40), v), { x: 1 });
  assert.equal(unseal("b".repeat(40), v), undefined);
  assert.equal(unseal("a".repeat(40), v.slice(0, -2) + "AA"), undefined);
});

test("API without a session asks the browser to sign in", async () => {
  const r = await call("/api/config", { headers: { "x-pcx-request": "1" } });
  assert.equal(r.status, 401);
  assert.equal(r.body.login, "/auth/login");
});

test("API calls without the request header are refused", async () => {
  const r = await call("/api/config");
  assert.equal(r.status, 403);
});

test("login redirects to Entra with PKCE, state and nonce", async () => {
  const r = await call("/auth/login");
  assert.equal(r.status, 302);
  const loc = new URL(r.headers.location);
  assert.equal(loc.origin + loc.pathname, `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/authorize`);
  assert.equal(loc.searchParams.get("code_challenge_method"), "S256");
  assert.ok(loc.searchParams.get("state"));
  assert.ok(loc.searchParams.get("nonce"));
  assert.match(loc.searchParams.get("scope")!, /offline_access https:\/\/org-dev\.crm11\.dynamics\.com\/user_impersonation/);
  assert.match(r.headers["set-cookie"][0], /HttpOnly; SameSite=Lax/);
});

test("callback with a tampered state is refused", async () => {
  const start = await call("/auth/login");
  const flow = cookieValue(start.headers["set-cookie"], "pcx_flow");
  const r = await call("/auth/callback?code=abc&state=wrong", { cookie: `pcx_flow=${encodeURIComponent(flow)}` });
  assert.equal(r.status, 400);
});

test("users from another tenant are refused", async () => {
  const r = await signIn({ ...goodClaims, tid: "ffffffff-ffff-ffff-ffff-ffffffffffff" });
  assert.equal(r.status, 403);
  assert.match(String(r.body), /different tenant/);
});

test("signed-in user: each environment is called with that user's own token", async () => {
  const r = await signIn(goodClaims);
  assert.equal(r.status, 302);
  assert.equal(r.location, "/#/solutions");
  const cfg = await call("/api/config", { cookie: r.cookie, headers: { "x-pcx-request": "1" } });
  assert.equal(cfg.body.mode, "hosted");
  assert.equal(cfg.body.user, "sam@contoso.com");

  seenTokens.length = 0;
  await call("/api/solutions", { cookie: r.cookie, headers: { "x-pcx-request": "1" } });
  assert.ok(seenTokens.includes("org-dev.crm11.dynamics.com Bearer at-dev"));
  assert.ok(seenTokens.includes("org.crm11.dynamics.com Bearer at-prod"));
  const refresh = tokenCalls.find((p) => p.get("grant_type") === "refresh_token");
  assert.equal(refresh!.get("scope"), "https://org.crm11.dynamics.com/user_impersonation offline_access");
});

test("changes are logged under the signed-in user and need a reason in PROD", async () => {
  const r = await signIn(goodClaims);
  const h = { "x-pcx-request": "1" };
  const body = { env: "PROD", kind: "flow", ids: ["99999999-9999-9999-9999-999999999999"], on: false };
  const no = await call("/api/components/state", { method: "POST", cookie: r.cookie, headers: h, body });
  assert.equal(no.status, 400);
  const cross = await call("/api/components/state", { method: "POST", cookie: r.cookie, headers: { ...h, origin: "https://evil.example.com" }, body: { ...body, reason: "test" } });
  assert.equal(cross.status, 403);
  const ok = await call("/api/components/state", { method: "POST", cookie: r.cookie, headers: h, body: { ...body, reason: "SAP outage" } });
  assert.equal(ok.status, 200);
  const acts = await call("/api/actions", { cookie: r.cookie, headers: h });
  assert.equal(acts.body.actions[0].actor, "sam@contoso.com");
});

test("an expired refresh token sends the user back to sign in", async () => {
  const r = await signIn(goodClaims);
  // Break the stored refresh token for this session, then ask for an environment not yet cached.
  const sid = r.cookie.split("=")[1]!;
  const s = (auth as unknown as { sessions: Map<string, { refreshToken: string; tokens: Map<string, unknown> }> }).sessions.get(sid)!;
  s.refreshToken = "rt-revoked";
  s.tokens.clear();
  const res = await call("/api/components?env=PROD&kind=flow", { cookie: r.cookie, headers: { "x-pcx-request": "1" } });
  assert.equal(res.status, 401);
  assert.equal(res.body.login, "/auth/login");
});

test("sign out ends the session", async () => {
  const r = await signIn(goodClaims);
  const out = await call("/auth/logout", { cookie: r.cookie });
  assert.equal(out.status, 302);
  assert.match(out.headers.location, /oauth2\/v2\.0\/logout/);
  const after = await call("/api/config", { cookie: r.cookie, headers: { "x-pcx-request": "1" } });
  assert.equal(after.status, 401);
});

test("requests for another host name are refused", async () => {
  const r = await call("/api/config", { headers: { host: "evil.example.com", "x-pcx-request": "1" } });
  assert.equal(r.status, 421);
});
