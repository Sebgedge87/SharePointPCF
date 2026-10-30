import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DataverseClient } from "../src/core/dataverse.js";
import { Workspace } from "../src/core/environments.js";
import { acrossEnvs, matrix } from "../src/core/multi.js";
import { changeJobs, listProblemJobs } from "../src/core/jobs.js";
import { listRoles, listUserRoles, rolePrivileges } from "../src/core/security.js";
import { listConnectionRefs, listEnvVars, setEnvVarValue } from "../src/core/configdata.js";
import { removeUnmanagedLayer } from "../src/core/compare.js";
import { evaluateAlerts, newAlerts, rememberPosted, teamsMessage, validateWebhook, type Alert } from "../src/core/alerts.js";
import { renderReportCsv, renderReportHtml, type HealthReport } from "../src/core/report.js";
import { PolicyError } from "../src/core/components.js";
import type { PcxConfig } from "../src/core/config.js";
import { DEV, PROD, fakeFetch, fakeTokens } from "./helpers.js";

const noLog = () => {};
const J1 = "a0000000-0000-0000-0000-000000000001";

test("matrix lines items up per environment, with null where missing", () => {
  const rows = matrix({ DEV: [{ k: "a", v: 1 }, { k: "b", v: 2 }], PROD: [{ k: "a", v: 3 }] }, ["DEV", "PROD"], (x) => x.k, (x) => ({ name: x.k }));
  const a = rows.find((r) => r.key === "a")!;
  const b = rows.find((r) => r.key === "b")!;
  assert.equal(a.cells.PROD!.v, 3);
  assert.equal(b.cells.PROD, null);
});

test("acrossEnvs collects results and errors per environment", async () => {
  const config: PcxConfig = { auth: { provider: "azps" }, environments: [DEV, PROD] };
  const ws = new Workspace(config, fakeTokens, { fetchImpl: fakeFetch(() => undefined).fn });
  const r = await acrossEnvs(ws, config.environments, async (_c, env) => {
    if (env.name === "PROD") throw new Error("no access");
    return 1;
  });
  assert.deepEqual(r.results, { DEV: 1 });
  assert.deepEqual(r.errors, { PROD: "no access" });
});

test("problem jobs are classified, and cancelling in PROD needs a reason", async () => {
  const f = fakeFetch((c) => {
    if (c.method === "PATCH") return { status: 204 };
    return { body: { value: [
      { asyncoperationid: J1, name: "Bulk delete", statuscode: 31, statecode: 3, message: "Timeout", createdon: "2026-10-29T10:00:00Z" },
      { asyncoperationid: "a0000000-0000-0000-0000-000000000002", name: "Workflow X", statuscode: 10, statecode: 1, createdon: "2026-10-29T09:00:00Z" },
      { asyncoperationid: "a0000000-0000-0000-0000-000000000003", name: "Import", statuscode: 20, statecode: 2, createdon: "2026-10-29T08:00:00Z" }
    ] } };
  });
  const client = new DataverseClient(PROD, fakeTokens, { fetchImpl: f.fn });
  const jobs = await listProblemJobs(client, new Date("2026-10-20"), new Date("2026-10-30"));
  assert.deepEqual(jobs.map((j) => j.problem), ["failed", "suspended", "long-running"]);
  assert.match(decodeURIComponent(f.calls[0]!.url), /statuscode eq 31 or statecode eq 1/);
  await assert.rejects(changeJobs(client, [{ id: J1, name: "x" }], "cancel", { source: "cli" }, noLog), PolicyError);
  const r = await changeJobs(client, [{ id: J1, name: "x" }], "cancel", { reason: "stuck since Monday", source: "cli" }, noLog);
  assert.equal(r[0]!.ok, true);
  assert.equal(f.calls.at(-1)!.body, '{"statecode":3,"statuscode":32}');
});

test("users carry direct and team roles; logins are lower-cased for matching", async () => {
  const f = fakeFetch(() => ({ body: { value: [
    { systemuserid: "u1", fullname: "Ana", domainname: "Ana@Contoso.com", systemuserroles_association: [{ name: "Salesperson" }, { name: "Salesperson" }], teammembership_association: [{ name: "Sales", teamroles_association: [{ name: "Basic User" }] }] },
    { systemuserid: "u2", fullname: "SYSTEM", domainname: "" }
  ] } }));
  const users = await listUserRoles(new DataverseClient(DEV, fakeTokens, { fetchImpl: f.fn }));
  assert.deepEqual(users, [{ login: "ana@contoso.com", name: "Ana", businessUnit: undefined, roles: ["Salesperson"], teamRoles: ["Basic User"] }]);
});

test("roles list root business-unit roles with user counts; privileges come back with readable levels", async () => {
  const R = "b0000000-0000-0000-0000-000000000001";
  const f = fakeFetch((c) => {
    if (c.url.includes("RetrieveRolePrivilegesRole")) return { body: { RolePrivileges: [{ PrivilegeId: "p1", PrivilegeName: "prvReadAccount", Depth: "Global" }, { PrivilegeId: "p2", Depth: "Basic" }] } };
    if (c.url.includes("privileges?")) return { body: { value: [{ privilegeid: "p2", name: "prvWriteAccount" }] } };
    return { body: { value: [{ roleid: R, name: "Salesperson", ismanaged: true, systemuserroles_association: [{ systemuserid: "u1" }, { systemuserid: "u2" }] }] } };
  });
  const client = new DataverseClient(DEV, fakeTokens, { fetchImpl: f.fn });
  const roles = await listRoles(client);
  assert.deepEqual(roles, [{ id: R, name: "Salesperson", managed: true, users: 2 }]);
  assert.match(decodeURIComponent(f.calls[0]!.url), /_parentroleid_value eq null/);
  assert.deepEqual(await rolePrivileges(client, R), [{ name: "prvReadAccount", depth: "Organization" }, { name: "prvWriteAccount", depth: "User" }]);
});

test("environment variables: effective value, missing, and secrets never read", async () => {
  const f = fakeFetch(() => ({ body: { value: [
    { environmentvariabledefinitionid: "d1", schemaname: "fp_ApiUrl", type: 100000000, defaultvalue: "https://dev", environmentvariabledefinition_environmentvariablevalue: [{ environmentvariablevalueid: "v1", value: "https://prod" }] },
    { environmentvariabledefinitionid: "d2", schemaname: "fp_Region", type: 100000000, defaultvalue: null, environmentvariabledefinition_environmentvariablevalue: [] },
    { environmentvariabledefinitionid: "d3", schemaname: "fp_Key", type: 100000005, defaultvalue: "vault-ref", environmentvariabledefinition_environmentvariablevalue: [{ environmentvariablevalueid: "v3", value: "secret-ref" }] }
  ] } }));
  const vars = await listEnvVars(new DataverseClient(DEV, fakeTokens, { fetchImpl: f.fn }));
  assert.equal(vars[0]!.effective, "https://prod");
  assert.equal(vars[1]!.missing, true);
  assert.equal(vars[2]!.secret, true);
  assert.equal(vars[2]!.effective, undefined);
  assert.equal(vars[2]!.missing, false);
});

test("setting a variable updates the existing value or creates one; secrets are refused", async () => {
  const D = "c0000000-0000-0000-0000-000000000001";
  const V = "c0000000-0000-0000-0000-000000000002";
  const defs = [
    { environmentvariabledefinitionid: D, schemaname: "fp_Region", type: 100000000, environmentvariabledefinition_environmentvariablevalue: [] },
    { environmentvariabledefinitionid: "c0000000-0000-0000-0000-000000000003", schemaname: "fp_Url", type: 100000000, environmentvariabledefinition_environmentvariablevalue: [{ environmentvariablevalueid: V, value: "a" }] },
    { environmentvariabledefinitionid: "c0000000-0000-0000-0000-000000000004", schemaname: "fp_Key", type: 100000005, environmentvariabledefinition_environmentvariablevalue: [] }
  ];
  const f = fakeFetch((c) => (c.method === "GET" ? { body: { value: defs } } : { status: 204 }));
  const client = new DataverseClient(PROD, fakeTokens, { fetchImpl: f.fn });
  await assert.rejects(setEnvVarValue(client, "fp_Region", "UK", { source: "cli" }, noLog), PolicyError);
  await setEnvVarValue(client, "fp_Region", "UK", { reason: "go-live config", source: "cli" }, noLog);
  const post = f.calls.find((c) => c.method === "POST")!;
  assert.deepEqual(JSON.parse(post.body!), { schemaname: "fp_Region_value", value: "UK", "EnvironmentVariableDefinitionId@odata.bind": `/environmentvariabledefinitions(${D})` });
  await setEnvVarValue(client, "fp_Url", "b", { reason: "go-live config", source: "cli" }, noLog);
  assert.ok(f.calls.some((c) => c.method === "PATCH" && c.url.includes(`environmentvariablevalues(${V})`)));
  await assert.rejects(setEnvVarValue(client, "fp_Key", "x", { reason: "go-live config", source: "cli" }, noLog), /Key Vault/);
});

test("connection references report whether a connection is set", async () => {
  const f = fakeFetch(() => ({ body: { value: [
    { connectionreferenceid: "r1", connectionreferencelogicalname: "fp_sharedsql", connectionreferencedisplayname: "SQL", connectorid: "/providers/Microsoft.PowerApps/apis/shared_sql", connectionid: "abc" },
    { connectionreferenceid: "r2", connectionreferencelogicalname: "fp_sap", connectorid: "/providers/Microsoft.PowerApps/apis/shared_sap", connectionid: null }
  ] } }));
  const refs = await listConnectionRefs(new DataverseClient(DEV, fakeTokens, { fetchImpl: f.fn }));
  assert.deepEqual(refs.map((r) => [r.displayName, r.connector, r.connected]), [["SQL", "sql", true], ["fp_sap", "sap", false]]);
});

test("removing an unmanaged change calls RemoveActiveCustomizations with the component's name", async () => {
  const f = fakeFetch(() => ({ status: 204 }));
  const client = new DataverseClient(PROD, fakeTokens, { fetchImpl: f.fn });
  const FORM = "d0000000-0000-0000-0000-000000000001";
  await assert.rejects(removeUnmanagedLayer(client, 60, FORM, "Case form", { source: "dashboard" }, noLog), PolicyError);
  await removeUnmanagedLayer(client, 60, FORM, "Case form", { reason: "hotfix moved to DEV", source: "dashboard" }, noLog);
  assert.ok(f.calls[0]!.url.endsWith("RemoveActiveCustomizations"));
  assert.deepEqual(JSON.parse(f.calls[0]!.body!), { SolutionComponentName: "SystemForm", ComponentId: FORM });
  await assert.rejects(removeUnmanagedLayer(client, 300, FORM, "Canvas", { reason: "x y z", source: "dashboard" }, noLog), /maker portal/);
});

test("alerts come from every environment and unreachable ones are critical", async () => {
  const config: PcxConfig = { auth: { provider: "azps" }, environments: [DEV, PROD] };
  const f = fakeFetch((c) => {
    const u = decodeURIComponent(c.url);
    if (u.startsWith(DEV.url)) return { status: 401, body: { error: { message: "no access" } } };
    if (u.endsWith("WhoAmI")) return { body: { UserId: "u" } };
    if (u.includes("systemusers(")) return { body: { domainname: "me" } };
    if (u.includes("flowruns")) return { body: { value: [{ flowrunid: "r", name: "1", status: "Failed", starttime: "2026-10-30T08:00:00Z", _workflow_value: "w", errormessage: "boom" }] } };
    if (u.includes("/workflows?")) return { body: { value: [{ workflowid: "w", name: "SAP sync" }] } };
    if (u.includes("plugintracelogs?")) return { body: { value: [] } };
    if (u.includes("plugintracelogsetting")) return { body: { value: [{ organizationid: "o", plugintracelogsetting: 0 }] } };
    if (u.includes("isauditenabled")) return { body: { value: [{ organizationid: "o", isauditenabled: false }] } };
    if (u.includes("asyncoperations")) return { body: { value: [] } };
    if (u.includes("environmentvariabledefinitions")) return { body: { value: [{ environmentvariabledefinitionid: "d", schemaname: "fp_Region", type: 100000000 }] } };
    if (u.includes("connectionreferences")) return { body: { value: [{ connectionreferenceid: "r", connectionreferencelogicalname: "fp_sap", connectionid: null }] } };
    return { body: { value: [] } };
  });
  const ws = new Workspace(config, fakeTokens, { fetchImpl: f.fn });
  const alerts = await evaluateAlerts(ws, config.environments, new Date("2026-10-29T08:00:00Z"), new Date("2026-10-30T09:00:00Z"));
  const titles = alerts.map((a) => `${a.severity}|${a.env}|${a.title}`);
  assert.equal(alerts[0]!.severity, "critical");
  assert.ok(titles.includes("critical|DEV|Can't reach DEV"));
  assert.ok(titles.includes("critical|PROD|Connection reference fp_sap has no connection"));
  assert.ok(titles.includes('warning|PROD|Flow "SAP sync" failed 1 time'));
  assert.ok(titles.includes("warning|PROD|Environment variable fp_Region has no value"));
  assert.ok(titles.includes("warning|PROD|Auditing is off"));
  assert.ok(titles.includes("info|PROD|Plugin tracing is off"));
});

test("Teams: only Microsoft webhook hosts, adaptive card body, and each alert posted once", () => {
  assert.throws(() => validateWebhook("https://evil.example.com/hook"));
  assert.throws(() => validateWebhook("http://x.webhook.office.com/a"));
  assert.ok(validateWebhook("https://contoso.webhook.office.com/webhookb2/abc"));
  assert.ok(validateWebhook("https://prod-12.westeurope.logic.azure.com/workflows/abc"));
  const a: Alert = { id: "PROD|audit", env: "PROD", severity: "warning", kind: "audit", title: "Auditing is off", route: "#/audit" };
  const msg = teamsMessage([a]) as { attachments: { content: { body: { text: string }[] } }[] };
  assert.match(msg.attachments[0]!.content.body[1]!.text, /\*\*PROD\*\* · Auditing is off/);
  const path = join(mkdtempSync(join(tmpdir(), "pcx-")), "state.json");
  assert.equal(newAlerts([a], path).length, 1);
  rememberPosted([a], path);
  assert.equal(newAlerts([a], path).length, 0);
  assert.equal(newAlerts([a], path, new Date(Date.now() + 15 * 86_400_000)).length, 1);
});

test("report HTML escapes values and CSV quotes them", () => {
  const r: HealthReport = {
    generatedAt: "2026-10-30T09:00:00Z",
    days: 7,
    environments: ["DEV"],
    health: { DEV: { status: { name: "DEV", url: "", managed: false, connected: false, error: "<script>alert(1)</script>" }, topFailures: [], flowFailed: 2 } },
    solutions: [],
    drift: [],
    alerts: [{ id: "x", env: "DEV", severity: "critical", kind: "access", title: 'Can\'t reach "DEV"', route: "#/" }]
  };
  const html = renderReportHtml(r);
  assert.ok(!html.includes("<script>alert"));
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(html.includes("Can&#39;t reach &quot;DEV&quot;"));
  const csv = renderReportCsv(r);
  assert.match(csv, /^environment,reachable/);
  assert.match(csv, /"DEV","false","false"/);
});
