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
let deviceFinish: () => void = () => {};
let deviceCancelled = false;
const provider: TokenProvider = {
  name: "azps",
  login: async () => void logins++,
  logout: async () => void logouts++,
  startDeviceLogin: async () => ({ code: "ABCD-1234", url: "https://microsoft.com/devicelogin", done: new Promise<void>((r) => (deviceFinish = r)), cancel: () => void (deviceCancelled = true) }),
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

test("several environments can be added at once from the lookup", async () => {
  const r = await post("/api/account/envs", { environments: [{ name: "TEST", url: "https://contoso-test.crm11.dynamics.com", managed: true }, { name: "PROD", url: "https://contoso.crm11.dynamics.com" }] });
  assert.equal(r.status, 200);
  assert.deepEqual(config.environments.map((e) => e.name), ["DEV", "TEST", "PROD"]);
  const clash = await post("/api/account/envs", { environments: [{ name: "prod", url: "https://x.crm.dynamics.com" }] });
  assert.equal(clash.status, 400);
  assert.deepEqual(config.environments.map((e) => e.name), ["DEV", "TEST", "PROD"]);
});

function get(path: string) {
  return new Promise<any>((resolve, reject) => {
    request({ host: "127.0.0.1", port: srv.port, path, headers: { host: `127.0.0.1:${srv.port}`, "x-pcx-key": srv.key } }, (res) => {
      let t = "";
      res.on("data", (d) => (t += d));
      res.on("end", () => resolve(JSON.parse(t)));
    }).on("error", reject).end();
  });
}

test("sign-in with a code: start shows the code, status follows it, cancel stops it", async () => {
  const start = await post("/api/account/device/start", {});
  assert.deepEqual(start.body, { code: "ABCD-1234", url: "https://microsoft.com/devicelogin" });
  assert.equal((await get("/api/account/device/status")).state, "waiting");
  deviceFinish();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal((await get("/api/account/device/status")).state, "done");
  await post("/api/account/device/start", {});
  await post("/api/account/device/cancel", {});
  assert.equal(deviceCancelled, true);
  assert.equal((await get("/api/account/device/status")).state, "cancelled");
});

test("the in-page terminal runs pcx commands and refuses ones that don't belong there", async () => {
  const help = await post("/api/cli/run", { args: ["help"] });
  assert.equal(help.status, 200);
  assert.equal(help.body.code, 0);
  assert.match(help.body.output, /pcx .* Power Platform environment console/);
  const bad = await post("/api/cli/run", { args: ["nonsense"] });
  assert.equal(bad.body.code, 2);
  assert.match(bad.body.output, /Unknown command/);
  assert.match((await post("/api/cli/run", { args: ["serve"] })).body.output, /already running/);
  assert.match((await post("/api/cli/run", { args: ["auth", "login"] })).body.output, /Sign in button/);
  assert.match((await post("/api/cli/run", { args: ["env", "list", "--config", "x.json"] })).body.output, /can't be changed/);
  assert.equal((await post("/api/cli/run", { args: [] })).status, 400);
});
