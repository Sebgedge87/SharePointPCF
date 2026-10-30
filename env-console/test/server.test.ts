import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request } from "node:http";
import { startServer, type RunningServer } from "../src/server/index.js";
import { Workspace } from "../src/core/environments.js";
import type { PcxConfig } from "../src/core/config.js";
import { DEV, PROD, fakeFetch, fakeTokens } from "./helpers.js";

const ID1 = "11111111-1111-1111-1111-111111111111";
const config: PcxConfig = { auth: { provider: "azps" }, environments: [DEV, PROD] };
const patches: string[] = [];

const f = fakeFetch((c) => {
  if (c.method === "PATCH") return patches.push(c.url), { status: 204 };
  if (c.url.endsWith("WhoAmI")) return { body: { UserId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" } };
  if (c.url.includes("systemusers(")) return { body: { domainname: "admin@contoso.com" } };
  if (c.url.includes("RetrieveVersion")) return { body: { Version: "9.2.1" } };
  if (c.url.includes("/solutions")) {
    const v = c.url.startsWith(DEV.url) ? "1.1.0.0" : "1.0.0.0";
    return { body: { value: [{ solutionid: "s", uniquename: "CoreCase", friendlyname: "Core Case", version: v, ismanaged: !c.url.startsWith(DEV.url), publisherid: { uniquename: "core", friendlyname: "Core", customizationprefix: "core" } }] } };
  }
  if (c.url.includes("/workflows")) return { body: { value: [{ workflowid: ID1, name: "SAP order sync", statecode: 1 }] } };
  if (c.url.includes("sdkmessageprocessingsteps")) return { body: { value: [] } };
  return undefined;
});

let srv: RunningServer;
before(async () => {
  process.env.PCX_ACTION_LOG = join(mkdtempSync(join(tmpdir(), "pcx-")), "actions.log");
  srv = await startServer({ config, port: 0, key: "k".repeat(32), workspace: new Workspace(config, fakeTokens, { fetchImpl: f.fn }) });
});
after(() => srv.close());

function call(path: string, opts: { method?: string; key?: string | null; host?: string; body?: unknown; origin?: string } = {}) {
  return new Promise<{ status: number; body: any; headers: Record<string, unknown> }>((resolve, reject) => {
    const headers: Record<string, string> = { host: opts.host ?? `127.0.0.1:${srv.port}` };
    if (opts.key !== null) headers["x-pcx-key"] = opts.key ?? srv.key;
    if (opts.origin) headers.origin = opts.origin;
    let data: string | undefined;
    if (opts.body !== undefined) {
      data = JSON.stringify(opts.body);
      headers["content-type"] = "application/json";
    }
    const req = request({ host: "127.0.0.1", port: srv.port, path, method: opts.method ?? "GET", headers }, (res) => {
      let text = "";
      res.on("data", (d) => (text += d));
      res.on("end", () => {
        let body: unknown = text;
        try {
          body = JSON.parse(text);
        } catch {
          /* static file */
        }
        resolve({ status: res.statusCode!, body, headers: res.headers });
      });
    });
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

test("serves the dashboard with a strict content security policy", async () => {
  const r = await call("/", { key: null });
  assert.equal(r.status, 200);
  assert.match(String(r.headers["content-security-policy"]), /default-src 'none'/);
  assert.match(String(r.body), /Env Console/);
});

test("API needs the key and the expected host", async () => {
  assert.equal((await call("/api/config", { key: null })).status, 401);
  assert.equal((await call("/api/config", { key: "wrong" })).status, 401);
  assert.equal((await call("/api/config", { host: "evil.example.com" })).status, 421);
  const ok = await call("/api/config");
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body.environments.map((e: { name: string }) => e.name), ["DEV", "PROD"]);
});

test("status reports user, version and counts", async () => {
  const r = await call("/api/status?env=PROD");
  assert.equal(r.body.connected, true);
  assert.equal(r.body.user, "admin@contoso.com");
  assert.equal(r.body.version, "9.2.1");
  assert.equal(r.body.flowsOn, 1);
});

test("solutions come back as a cross-environment matrix", async () => {
  const r = await call("/api/solutions");
  assert.equal(r.body.rows[0].differs, true);
  assert.equal(r.body.rows[0].versions.DEV.version, "1.1.0.0");
  assert.equal(r.body.publishers[0].count, 1);
});

test("changing state: reason enforced in PROD, cross-site posts refused, change logged", async () => {
  const body = { env: "PROD", kind: "flow", ids: [ID1], on: false };
  const noReason = await call("/api/components/state", { method: "POST", body });
  assert.equal(noReason.status, 400);
  assert.match(noReason.body.error, /reason/);
  const cross = await call("/api/components/state", { method: "POST", body: { ...body, reason: "SAP outage" }, origin: "https://evil.example.com" });
  assert.equal(cross.status, 403);
  const bad = await call("/api/components/state", { method: "POST", body: { ...body, ids: ["99999999-9999-9999-9999-999999999999"], reason: "x y z" } });
  assert.equal(bad.status, 400);
  assert.equal(patches.length, 0);
  const done = await call("/api/components/state", { method: "POST", body: { ...body, reason: "SAP outage" } });
  assert.equal(done.status, 200);
  assert.equal(done.body.results[0].ok, true);
  assert.equal(patches.length, 1);
  const log = readFileSync(process.env.PCX_ACTION_LOG!, "utf8");
  assert.match(log, /"reason":"SAP outage"/);
  assert.match(log, /"actor":"admin@contoso.com"/);
  const acts = await call("/api/actions");
  assert.equal(acts.body.actions[0].name, "SAP order sync");
});
