import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request } from "node:http";
import { findEnv, saveConfig, type PcxConfig } from "../src/core/config.js";
import { chooseEnvironments, mergeDiscovered, resolveUnsaved } from "../src/core/envlist.js";
import type { DiscoveredEnv } from "../src/core/discovery.js";
import { BAP_HOST, BAP_RESOURCE, createBody, createEnvironment, validateNewEnvironment } from "../src/core/provision.js";
import { startServer } from "../src/server/index.js";
import { Workspace } from "../src/core/environments.js";
import type { TokenProvider } from "../src/core/auth.js";
import { DEV, fakeFetch, fakeTokens } from "./helpers.js";

const found = (friendlyName: string, url: string, extra: Partial<DiscoveredEnv> = {}): DiscoveredEnv => ({
  friendlyName, uniqueName: "", url, enabled: true, suggestedName: "", suggestedManaged: !/dev/i.test(friendlyName), ...extra
});

test("found environments sit next to saved ones; hidden, disabled and already-saved ones are skipped", () => {
  const config: PcxConfig = { auth: { provider: "azps" }, environments: [{ ...DEV, label: "Dev" }], hiddenEnvironments: ["https://hidden.crm4.dynamics.com"] };
  const added = mergeDiscovered(config, [
    found("Dev", DEV.url),
    found("Seb G's Uni Project", "https://orgc98ad8b7.crm4.dynamics.com"),
    found("Sebastian Gedge's Environment", "https://org9b818508.crm4.dynamics.com"),
    found("Old trial", "https://old.crm4.dynamics.com", { enabled: false }),
    found("Hidden one", "https://hidden.crm4.dynamics.com")
  ]);
  assert.deepEqual(added.map((e) => e.label), ["Seb G's Uni Project", "Sebastian Gedge's Environment"]);
  assert.ok(added.every((e) => e.discovered));
  assert.equal(config.environments.length, 3);
  assert.equal(new Set(config.environments.map((e) => e.name)).size, 3, "short names are unique");
  // A second lookup replaces the found ones instead of adding duplicates.
  mergeDiscovered(config, [found("Seb G's Uni Project", "https://orgc98ad8b7.crm4.dynamics.com")]);
  assert.deepEqual(config.environments.map((e) => e.label), ["Dev", "Seb G's Uni Project"]);
});

test("found environments are never written to the config file", () => {
  const path = join(mkdtempSync(join(tmpdir(), "pcx-")), "config.json");
  const config: PcxConfig = { auth: { provider: "azps" }, environments: [{ ...DEV }, { name: "UNI", label: "Uni", url: "https://orgc98ad8b7.crm4.dynamics.com", managed: true, discovered: true }] };
  saveConfig(config, path);
  const onDisk = JSON.parse(readFileSync(path, "utf8")) as PcxConfig;
  assert.deepEqual(onDisk.environments.map((e) => e.name), ["DEV"]);
});

test("--env takes the short name, the display name or the URL", () => {
  const config: PcxConfig = { auth: { provider: "azps" }, environments: [{ name: "UNI", label: "Seb G's Uni Project", url: "https://orgc98ad8b7.crm4.dynamics.com", managed: true }] };
  assert.equal(findEnv(config, "uni").name, "UNI");
  assert.equal(findEnv(config, "seb g's uni project").name, "UNI");
  assert.equal(findEnv(config, "https://orgc98ad8b7.crm4.dynamics.com/main.aspx").name, "UNI");
  assert.equal(findEnv(config, "orgc98ad8b7.crm4.dynamics.com").name, "UNI");
  assert.throws(() => findEnv(config, "nope"), /Unknown environment/);
});

test("new environment requests are checked before anything is sent", () => {
  assert.throws(() => validateNewEnvironment({ displayName: "", region: "unitedkingdom" }), /name/);
  assert.throws(() => validateNewEnvironment({ displayName: "X", region: "mars" }), /Region must be/);
  assert.throws(() => validateNewEnvironment({ displayName: "X", region: "europe", type: "Gold" as never }), /Type must be/);
  assert.throws(() => validateNewEnvironment({ displayName: "X", region: "europe", domain: "bad domain" }), /URL name/);
  assert.throws(() => validateNewEnvironment({ displayName: "X", region: "europe", securityGroupId: "not-a-guid" }), /object ID/);
  const ok = validateNewEnvironment({ displayName: " Seb Test ", region: "United Kingdom", type: "sandbox" as never, domain: "SebTest" });
  assert.deepEqual(ok, { displayName: "Seb Test", type: "Sandbox", region: "unitedkingdom", currency: "GBP", language: 1033, domain: "sebtest" });
  assert.deepEqual(createBody(ok), {
    location: "unitedkingdom",
    properties: {
      displayName: "Seb Test",
      environmentSku: "Sandbox",
      databaseType: "CommonDataService",
      linkedEnvironmentMetadata: { baseLanguage: 1033, currency: { code: "GBP" }, templates: [], domainName: "sebtest" }
    }
  });
});

test("creating waits for the operation and the Dataverse URL, talking only to the admin API", async () => {
  let polls = 0;
  const resources: string[] = [];
  const f = fakeFetch((c) => {
    if (c.method === "POST") return { status: 202, headers: { Location: `${BAP_HOST}/providers/Microsoft.BusinessAppPlatform/lifecycleOperations/op1?api-version=2021-04-01` } };
    if (c.url.includes("lifecycleOperations")) return ++polls < 2 ? { status: 202 } : { body: { name: "env-123", properties: { provisioningState: "Succeeded" } } };
    if (c.url.includes("/environments/env-123")) return { body: { name: "env-123", properties: { provisioningState: "Succeeded", linkedEnvironmentMetadata: { instanceUrl: "https://sebtest.crm11.dynamics.com/" } } } };
    return undefined;
  });
  const progress: string[] = [];
  const r = await createEnvironment({ token: async (res) => (resources.push(res), "t") }, validateNewEnvironment({ displayName: "Seb Test", region: "unitedkingdom" }), { fetchImpl: f.fn, sleep: async () => {}, onProgress: (m) => progress.push(m) });
  assert.deepEqual(r, { id: "env-123", displayName: "Seb Test", url: "https://sebtest.crm11.dynamics.com", state: "Succeeded" });
  assert.ok(f.calls.every((c) => c.url.startsWith(BAP_HOST + "/")), "tokens only go to the admin API");
  assert.ok(resources.every((x) => x === BAP_RESOURCE));
  assert.ok(progress.some((m) => /Ready/.test(m)));
});

test("a link to another host is refused, and a 403 says which admin role is needed", async () => {
  const evil = fakeFetch((c) => (c.method === "POST" ? { status: 202, headers: { Location: "https://evil.example.com/steal" } } : undefined));
  const req = validateNewEnvironment({ displayName: "X", region: "europe" });
  await assert.rejects(createEnvironment({ token: async () => "t" }, req, { fetchImpl: evil.fn, sleep: async () => {} }), /Refusing to follow a link/);
  assert.equal(evil.calls.length, 1);
  const denied = fakeFetch(() => ({ status: 403, body: { error: { code: "Forbidden", message: "nope" } } }));
  await assert.rejects(createEnvironment({ token: async () => "t" }, req, { fetchImpl: denied.fn }), /Power Platform administrator or Dynamics 365 administrator/);
});

// ---- dashboard server

function call(port: number, key: string, method: string, path: string, body?: unknown) {
  return new Promise<{ status: number; body: any }>((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path, method, headers: { host: `127.0.0.1:${port}`, "x-pcx-key": key, "content-type": "application/json" } }, (res) => {
      let t = "";
      res.on("data", (d) => (t += d));
      res.on("end", () => resolve({ status: res.statusCode!, body: JSON.parse(t || "{}") }));
    });
    req.on("error", reject);
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
}

test("with discovery on, the dashboard lists found environments, hides removed ones, and refuses changes without the role", async () => {
  const config: PcxConfig = { auth: { provider: "azps" }, environments: [{ ...DEV }], discovery: true };
  const saved: PcxConfig[] = [];
  const provider: TokenProvider = { name: "azps", login: async () => {}, logout: async () => {}, getToken: async () => ({ token: "t", expiresOn: new Date(Date.now() + 3_600_000) }) };
  const UNI = "https://orgc98ad8b7.crm4.dynamics.com";
  const KEEP = "https://keepme.crm4.dynamics.com";
  const f = fakeFetch((c) => {
    if (c.url.startsWith(UNI) && c.url.includes("_roletemplateid_value")) return { body: { domainname: "seb@formuspro.com", systemuserroles_association: [{ name: "Basic User" }] } };
    if (c.url.includes("/workflows?")) return { body: { value: [{ workflowid: "11111111-1111-1111-1111-111111111111", name: "A", statecode: 1, category: 5 }] } };
    return undefined;
  });
  const ws = new Workspace(config, { token: async () => "t" }, { fetchImpl: f.fn });
  const srv = await startServer({ config, port: 0, key: "k".repeat(32), workspace: ws, account: { provider, save: (c) => void saved.push(c), discover: async () => [found("Seb G's Uni Project", UNI), found("Keep Me Test", KEEP)] } });
  try {
    const cfg = await call(srv.port, srv.key, "GET", "/api/config");
    const uni = cfg.body.environments.find((e: { url: string }) => e.url === UNI);
    assert.ok(uni && uni.discovered, "found environment is listed");
    assert.equal(cfg.body.canCreate, true);

    const access = await call(srv.port, srv.key, "GET", "/api/access/all");
    assert.equal(access.body.results.DEV.can.admin, true);
    assert.equal(access.body.results[uni.name].can.customize, false);

    const refused = await call(srv.port, srv.key, "POST", "/api/components/state", { env: uni.name, kind: "flow", ids: ["11111111-1111-1111-1111-111111111111"], on: false, reason: "test change" });
    assert.equal(refused.status, 403);
    assert.match(refused.body.error, /System Administrator or System Customizer role in Seb G's Uni Project/);
    assert.equal(f.calls.filter((c) => c.method === "PATCH").length, 0, "nothing was changed");

    const keep = cfg.body.environments.find((e: { url: string }) => e.url === KEEP);
    const savedRes = await call(srv.port, srv.key, "POST", "/api/account/env", { url: KEEP, name: keep.name, label: "Keep Me Test", managed: true });
    assert.equal(savedRes.status, 200, JSON.stringify(savedRes.body));
    assert.ok(saved[saved.length - 1]!.environments.some((e) => e.url === KEEP && e.name === keep.name), "saved with the same short name");
    const after = await call(srv.port, srv.key, "GET", "/api/config?refresh=1");
    assert.equal(after.body.environments.filter((e: { url: string }) => e.url === KEEP).length, 1, "not listed twice");
    assert.equal(after.body.environments.find((e: { url: string }) => e.url === KEEP).discovered, false);

    const removed = await call(srv.port, srv.key, "POST", "/api/account/env/remove", { name: uni.name });
    assert.equal(removed.status, 200);
    const last = saved[saved.length - 1]!;
    assert.deepEqual(last.hiddenEnvironments, [UNI]);
    const again = await call(srv.port, srv.key, "GET", "/api/config?refresh=1");
    assert.ok(!again.body.environments.some((e: { url: string }) => e.url === UNI), "hidden stays hidden after the next lookup");
  } finally {
    await srv.close();
  }
});

test("creating an environment from the dashboard validates first and reports progress", async () => {
  const config: PcxConfig = { auth: { provider: "azps" }, environments: [{ ...DEV }] };
  const provider: TokenProvider = { name: "azps", login: async () => {}, logout: async () => {}, getToken: async () => ({ token: "t", expiresOn: new Date(Date.now() + 3_600_000) }) };
  const ws = new Workspace(config, { token: async () => "t" }, { fetchImpl: fakeFetch(() => undefined).fn });
  const srv = await startServer({ config, port: 0, key: "k".repeat(32), workspace: ws, account: { provider, save: () => {}, discover: async () => [] } });
  try {
    const bad = await call(srv.port, srv.key, "POST", "/api/account/env/create", { displayName: "X", region: "mars" });
    assert.equal(bad.status, 400);
    assert.match(bad.body.error, /Region must be/);
    const opts = await call(srv.port, srv.key, "GET", "/api/account/env/create/options");
    assert.ok(opts.body.types.includes("Sandbox") && opts.body.regions.unitedkingdom);
    const none = await call(srv.port, srv.key, "GET", "/api/account/env/create/status");
    assert.equal(none.body.state, "none");
  } finally {
    await srv.close();
  }
});

test("the CLI never changes anything without a yes: no --yes in a script means exit 3", async () => {
  const { main, NOT_CONFIRMED } = await import("../src/cli/index.js");
  const path = join(mkdtempSync(join(tmpdir(), "pcx-")), "config.json");
  saveConfig({ auth: { provider: "azps" }, environments: [] }, path);
  const write = process.stdout.write.bind(process.stdout);
  let printed = "";
  process.stdout.write = ((chunk: string) => ((printed += chunk), true)) as typeof process.stdout.write;
  try {
    const code = await main(["env", "create", "--name", "Seb Test", "--region", "unitedkingdom", "--config", path]);
    assert.equal(code, NOT_CONFIRMED);
    assert.match(printed, /Nothing changed\. Add --yes to go ahead/);
  } finally {
    process.stdout.write = write;
    delete process.env.PCX_CONFIG;
  }
});

test("by default nothing extra is loaded: you choose the environments, and that choice is saved", async () => {
  const config: PcxConfig = { auth: { provider: "azps" }, environments: [{ ...DEV, label: "Dev" }] };
  const saved: PcxConfig[] = [];
  const provider: TokenProvider = { name: "azps", login: async () => {}, logout: async () => {}, getToken: async () => ({ token: "t", expiresOn: new Date(Date.now() + 3_600_000) }) };
  const UNI = "https://orgc98ad8b7.crm4.dynamics.com";
  const LIVE = "https://formusprolive.crm11.dynamics.com";
  let lookups = 0;
  const ws = new Workspace(config, { token: async () => "t" }, { fetchImpl: fakeFetch(() => undefined).fn });
  const srv = await startServer({ config, port: 0, key: "k".repeat(32), workspace: ws, account: { provider, save: (c) => void saved.push(c), discover: async () => (lookups++, [found("Dev", DEV.url), found("Seb G's Uni Project", UNI), found("FormusProLive", LIVE)]) } });
  try {
    const cfg = await call(srv.port, srv.key, "GET", "/api/config");
    assert.deepEqual(cfg.body.environments.map((e: { url: string }) => e.url), [DEV.url], "only the chosen one is loaded");
    assert.equal(lookups, 0, "no lookup on load");
    const list = await call(srv.port, srv.key, "GET", "/api/account/discover");
    assert.deepEqual(list.body.environments.map((e: { added: boolean }) => e.added), [true, false, false], "the picker shows what's already chosen");
    const pick = await call(srv.port, srv.key, "POST", "/api/account/envs/select", { environments: [{ url: DEV.url }, { url: LIVE, label: "FormusProLive" }] });
    assert.equal(pick.status, 200);
    const last = saved[saved.length - 1]!;
    assert.deepEqual(last.environments.map((e) => e.url), [DEV.url, LIVE]);
    assert.equal(last.environments[0]!.label, "Dev", "an environment already chosen keeps its settings");
    const bad = await call(srv.port, srv.key, "POST", "/api/account/envs/select", { environments: [{ url: "https://evil.example.com" }] });
    assert.equal(bad.status, 400);
  } finally {
    await srv.close();
  }
});

test("chosen environments keep their settings; new ones get a short name and type", () => {
  const config: PcxConfig = { auth: { provider: "azps" }, environments: [{ name: "DEV", label: "Dev", url: DEV.url, managed: false }] };
  const next = chooseEnvironments(config, [{ url: DEV.url }, { url: "https://orgc98ad8b7.crm4.dynamics.com", label: "Seb G's Uni Project" }, { url: "https://x.crm4.dynamics.com", label: "Sandbox Dev" }]);
  assert.deepEqual(next[0], { name: "DEV", label: "Dev", url: DEV.url, managed: false });
  assert.equal(next[1]!.name, "SEB-G-S-UNI-PROJECT");
  assert.equal(next[2]!.managed, false, "DEV-like names are suggested as unmanaged");
});

test("--env can name an environment you didn't choose; only that one is looked up and added", async () => {
  const config: PcxConfig = { auth: { provider: "azps" }, environments: [{ ...DEV }] };
  const f = fakeFetch((c) => (c.url.includes("globaldisco") ? { body: { value: [
    { FriendlyName: "Seb G's Uni Project", UniqueName: "unq1", Url: "https://orgc98ad8b7.crm4.dynamics.com", State: 0 },
    { FriendlyName: "Other", UniqueName: "unq2", Url: "https://other.crm4.dynamics.com", State: 0 }
  ] } } : undefined));
  const none = await resolveUnsaved(config, ["DEV"], fakeTokens, f.fn as never);
  assert.deepEqual(none.added, []);
  assert.equal(f.calls.length, 0, "no lookup when the name is already known");
  const r = await resolveUnsaved(config, ["Seb G's Uni Project"], fakeTokens, f.fn as never);
  assert.deepEqual(r.added.map((e) => e.label), ["Seb G's Uni Project"]);
  assert.equal(config.environments.length, 2, "the others are not loaded");
  assert.equal(findEnv(config, "seb g's uni project").discovered, true);
});
