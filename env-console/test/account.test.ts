import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import { startServer, type RunningServer } from "../src/server/index.js";
import { Workspace } from "../src/core/environments.js";
import { TokenCache, type TokenProvider } from "../src/core/auth.js";
import type { PcxConfig } from "../src/core/config.js";
import { DEV, fakeFetch } from "./helpers.js";

const config: PcxConfig = { auth: { provider: "azps" }, environments: [{ ...DEV }] };
const saved: PcxConfig[] = [];
let logins = 0;
let logouts = 0;
let tokenCalls = 0;
const provider: TokenProvider = {
  name: "azps",
  login: async () => void logins++,
  logout: async () => void logouts++,
  getToken: async () => ((tokenCalls++), { token: "t", expiresOn: new Date(Date.now() + 3_600_000) })
};
const tokens = new TokenCache(provider);
let srv: RunningServer;

before(async () => {
  const ws = new Workspace(config, tokens, { fetchImpl: fakeFetch(() => ({ body: { UserId: "u" } })).fn });
  srv = await startServer({ config, port: 0, key: "k".repeat(32), workspace: ws, account: { provider, save: (c) => void saved.push(c) } });
});
after(() => srv.close());

function post(path: string, body: unknown) {
  return new Promise<{ status: number; body: any }>((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = request({ host: "127.0.0.1", port: srv.port, path, method: "POST", headers: { host: `127.0.0.1:${srv.port}`, "x-pcx-key": srv.key, "content-type": "application/json" } }, (res) => {
      let t = "";
      res.on("data", (d) => (t += d));
      res.on("end", () => resolve({ status: res.statusCode!, body: JSON.parse(t || "{}") }));
    });
    req.on("error", reject);
    req.end(data);
  });
}

test("signing in from the page runs the provider's sign-in and drops cached tokens", async () => {
  await tokens.token(DEV.url);
  assert.equal(tokenCalls, 1);
  const r = await post("/api/account/login", {});
  assert.equal(r.status, 200);
  assert.equal(logins, 1);
  await tokens.token(DEV.url);
  assert.equal(tokenCalls, 2); // fetched again after sign-in
  await post("/api/account/logout", {});
  assert.equal(logouts, 1);
});

test("environments can be added and removed from the page, and are saved", async () => {
  const bad = await post("/api/account/env", { name: "UAT", url: "https://evil.example.com" });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /not a Dataverse host/);
  const ok = await post("/api/account/env", { name: "UAT", url: "https://contoso-uat.crm11.dynamics.com/main.aspx", managed: true });
  assert.equal(ok.status, 200);
  assert.deepEqual(config.environments.map((e) => e.name), ["DEV", "UAT"]);
  assert.equal(saved.at(-1)!.environments[1]!.url, "https://contoso-uat.crm11.dynamics.com");
  const dup = await post("/api/account/env", { name: "uat", url: "https://x.crm.dynamics.com" });
  assert.equal(dup.status, 400);
  await post("/api/account/env/remove", { name: "UAT" });
  assert.deepEqual(config.environments.map((e) => e.name), ["DEV"]);
});

test("tenant can be set and cleared", async () => {
  const r = await post("/api/account/tenant", { tenant: "contoso.onmicrosoft.com" });
  assert.equal(r.body.tenantId, "contoso.onmicrosoft.com");
  assert.equal(saved.at(-1)!.tenantId, "contoso.onmicrosoft.com");
  const bad = await post("/api/account/tenant", { tenant: "not a tenant!" });
  assert.notEqual(bad.status, 200);
  const cleared = await post("/api/account/tenant", { tenant: "" });
  assert.equal(cleared.body.tenantId, null);
});
