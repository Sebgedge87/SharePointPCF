import { test } from "node:test";
import assert from "node:assert/strict";
import { DataverseClient } from "../src/core/dataverse.js";
import { compareSolution, diffComponent } from "../src/core/compare.js";
import { diffLines, prettyXml } from "../src/core/diff.js";
import { dailySeries, listFlowRuns, runStatus, setTraceSetting, topFailures, type FlowRun, type PluginLog } from "../src/core/runs.js";
import { listAuditEntries, setAudit } from "../src/core/audit.js";
import { applyUserSettings, planApply, validateSettings, type UserRow } from "../src/core/usersettings.js";
import { listComponents, PolicyError } from "../src/core/components.js";
import { sinceDate } from "../src/core/util.js";
import type { ActionEntry } from "../src/core/actionLog.js";
import { DEV, PROD, fakeFetch, fakeTokens } from "./helpers.js";

const FORM = "aaaaaaaa-0000-0000-0000-000000000001";
const VIEW = "aaaaaaaa-0000-0000-0000-000000000002";
const ONLY_DEV = "aaaaaaaa-0000-0000-0000-000000000003";
const noLog = () => {};

// ------------------------------------------------------------------ diff

test("line diff marks additions, deletions and folds unchanged runs", () => {
  const a = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"].join("\n");
  const b = ["a", "b", "c", "d", "E", "f", "g", "h", "i", "j", "k"].join("\n");
  const r = diffLines(a, b, 1);
  assert.equal(r.changed, true);
  assert.deepEqual(r.lines.filter((l) => l.t !== "ctx" && l.t !== "skip").map((l) => `${l.t}:${l.text}`), ["del:e", "add:E", "add:k"]);
  assert.ok(r.lines.some((l) => l.t === "skip"));
  assert.equal(diffLines("x", "x").changed, false);
});

test("XML is pretty-printed one element per line", () => {
  assert.equal(prettyXml("<form><tab><field name=\"a\" /></tab></form>"), '<form>\n  <tab>\n    <field name="a" />\n  </tab>\n</form>');
});

// ------------------------------------------------------------------ compare

function envFetch(managedLayer: boolean, formXml: string) {
  return fakeFetch((c) => {
    const u = decodeURIComponent(c.url);
    if (u.includes("/solutions?")) return { body: { value: [{ solutionid: "11111111-1111-1111-1111-111111111111", version: managedLayer ? "1.0.0.1" : "1.0.0.2", ismanaged: managedLayer }] } };
    if (u.includes("msdyn_solutioncomponentsummaries")) {
      const rows = [
        { msdyn_objectid: FORM, msdyn_componenttype: 60, msdyn_displayname: "Case main form", msdyn_primaryentityname: "incident", msdyn_ismanaged: managedLayer, msdyn_iscustomized: managedLayer },
        { msdyn_objectid: VIEW, msdyn_componenttype: 26, msdyn_displayname: "Active cases", msdyn_ismanaged: managedLayer, msdyn_iscustomized: false }
      ];
      if (!managedLayer) rows.push({ msdyn_objectid: ONLY_DEV, msdyn_componenttype: 1, msdyn_displayname: "Reporting table", msdyn_ismanaged: false, msdyn_iscustomized: false } as never);
      return { body: { value: rows } };
    }
    if (u.includes("systemforms(")) return { body: { formxml: formXml } };
    if (u.includes("savedqueries(")) return { body: { fetchxml: "<fetch><entity name='incident'/></fetch>", layoutxml: "<grid/>" } };
    return undefined;
  });
}

test("compare finds differences, components on one side, and unmanaged changes in managed environments", async () => {
  const a = new DataverseClient(DEV, fakeTokens, { fetchImpl: envFetch(false, "<form><field name='a'/></form>").fn });
  const b = new DataverseClient(PROD, fakeTokens, { fetchImpl: envFetch(true, "<form><field name='b'/></form>").fn });
  const r = await compareSolution(a, b, "CoreCase");
  const by = Object.fromEntries(r.rows.map((x) => [x.objectId, x]));
  assert.equal(by[FORM]!.status, "layer"); // different AND customized in managed PROD
  assert.equal(by[FORM]!.layerB, true);
  assert.equal(by[VIEW]!.status, "same");
  assert.equal(by[ONLY_DEV]!.status, "onlyA");
  assert.equal(by[ONLY_DEV]!.typeName, "Table");
  assert.equal(r.a.version, "1.0.0.2");
  assert.equal(r.counts.layer, 1);
  assert.equal(r.rows[0]!.status, "layer"); // most important first

  const d = await diffComponent(a, b, 60, FORM);
  assert.equal(d.supported, true);
  assert.ok(d.lines.some((l) => l.t === "add" && l.text.includes("'b'")));
});

test("compare refuses a solution that is in neither environment", async () => {
  const none = fakeFetch(() => ({ body: { value: [] } }));
  const a = new DataverseClient(DEV, fakeTokens, { fetchImpl: none.fn });
  const b = new DataverseClient(PROD, fakeTokens, { fetchImpl: none.fn });
  await assert.rejects(compareSolution(a, b, "Nope"), /not installed/);
});

// ------------------------------------------------------------------ components: custom vs Microsoft

test("Microsoft and system items are hidden unless asked for", async () => {
  const MS = "22222222-2222-2222-2222-222222222222";
  const f = fakeFetch((c) => {
    const u = decodeURIComponent(c.url);
    if (u.includes("/solutions?")) return { body: { value: [{ solutionid: MS, friendlyname: "Dynamics 365 Customer Service", uniquename: "msdyn_Service", publisherid: { uniquename: "MicrosoftCorporation", friendlyname: "Microsoft Corporation", customizationprefix: "msdyn" } }] } };
    if (u.includes("/workflows?")) return { body: { value: [
      { workflowid: "33333333-3333-3333-3333-333333333333", name: "Ours", statecode: 1 },
      { workflowid: "44444444-4444-4444-4444-444444444444", name: "Theirs", statecode: 1, solutionid: MS, ismanaged: true }
    ] } };
    return undefined;
  });
  const client = new DataverseClient(DEV, fakeTokens, { fetchImpl: f.fn });
  assert.deepEqual((await listComponents(client, "flow")).map((x) => x.name), ["Ours"]);
  const all = await listComponents(client, "flow", { includeSystem: true });
  assert.deepEqual(all.map((x) => [x.name, x.custom]), [["Ours", true], ["Theirs", false]]);
  assert.equal(all[1]!.solution, "Dynamics 365 Customer Service");
});

// ------------------------------------------------------------------ runs

test("run status words map to a small set", () => {
  assert.equal(runStatus("Failed"), "failed");
  assert.equal(runStatus("TimedOut"), "failed");
  assert.equal(runStatus("Succeeded"), "succeeded");
  assert.equal(runStatus("Cancelled"), "cancelled");
  assert.equal(runStatus(undefined), "other");
});

test("flow runs are labelled with the flow's name and linked to Power Automate", async () => {
  const WF = "55555555-5555-5555-5555-555555555555";
  const f = fakeFetch((c) => {
    const u = decodeURIComponent(c.url);
    if (u.includes("flowruns")) return { body: { value: [
      { flowrunid: "r1", name: "08585", status: "Failed", starttime: "2026-10-29T10:00:00Z", _workflow_value: WF, errorcode: "ActionFailed", errormessage: "SAP returned 503" },
      { flowrunid: "r2", name: "08586", status: "Succeeded", starttime: "2026-10-29T11:00:00Z", _workflow_value: WF }
    ] } };
    if (u.includes("/workflows?")) return { body: { value: [{ workflowid: WF, name: "SAP order sync", resourceid: "flow-guid" }] } };
    if (u.includes("RetrieveCurrentOrganization")) return { body: { Detail: { EnvironmentId: "env-guid" } } };
    return undefined;
  });
  const r = await listFlowRuns(new DataverseClient(DEV, fakeTokens, { fetchImpl: f.fn }), new Date("2026-10-28T00:00:00Z"));
  assert.equal(r.available, true);
  assert.equal(r.runs[0]!.flowName, "SAP order sync");
  assert.equal(r.runs[0]!.status, "failed");
  assert.equal(r.runs[0]!.link, "https://make.powerautomate.com/environments/env-guid/flows/flow-guid/runs/08585");
});

test("missing flow run history is reported, not thrown", async () => {
  const f = fakeFetch((c) => (c.url.includes("flowruns") ? { status: 404, body: { error: { message: "Resource not found for the segment 'flowruns'" } } } : undefined));
  const r = await listFlowRuns(new DataverseClient(DEV, fakeTokens, { fetchImpl: f.fn }), new Date());
  assert.equal(r.available, false);
  assert.match(r.error!, /not available/);
});

test("daily series has every day and top failures are ranked", () => {
  const since = new Date("2026-10-27T00:00:00Z");
  const now = new Date("2026-10-29T12:00:00Z");
  const flows: FlowRun[] = [
    { id: "1", flowName: "A", status: "failed", start: "2026-10-27T08:00:00Z", errorMessage: "boom" },
    { id: "2", flowName: "A", status: "failed", start: "2026-10-29T08:00:00Z", errorMessage: "boom again" },
    { id: "3", flowName: "B", status: "succeeded", start: "2026-10-29T09:00:00Z" }
  ];
  const plugins: PluginLog[] = [{ id: "p", typeName: "X.Plugin", message: "Update", at: "2026-10-28T10:00:00Z", mode: "sync", failed: true, exception: "NullReference\nat X" }];
  const days = dailySeries(flows, plugins, since, now);
  assert.deepEqual(days.map((d) => d.day), ["2026-10-27", "2026-10-28", "2026-10-29"]);
  assert.equal(days[2]!.flowFailed, 1);
  assert.equal(days[2]!.flowSucceeded, 1);
  assert.equal(days[1]!.pluginFailed, 1);
  const top = topFailures(flows, plugins);
  assert.deepEqual(top.map((g) => [g.name, g.failures, g.total]), [["A", 2, 2], ["X.Plugin", 1, 1]]);
  assert.equal(top[0]!.lastError, "boom again");
});

test("changing plugin tracing in PROD needs a reason and is logged", async () => {
  const f = fakeFetch((c) => (c.method === "PATCH" ? { status: 204 } : { body: { value: [{ organizationid: "66666666-6666-6666-6666-666666666666", plugintracelogsetting: 0 }] } }));
  const client = new DataverseClient(PROD, fakeTokens, { fetchImpl: f.fn });
  await assert.rejects(setTraceSetting(client, "exceptions", undefined, "me", "cli", noLog), PolicyError);
  const logged: ActionEntry[] = [];
  await setTraceSetting(client, "exceptions", "Investigating INC-1", "me", "cli", (e) => void logged.push(e));
  assert.equal(f.calls.find((c) => c.method === "PATCH")!.body, '{"plugintracelogsetting":1}');
  assert.equal(logged[0]!.action, "trace-log off → exceptions");
});

test("time ranges parse", () => {
  const now = Date.UTC(2026, 9, 30);
  assert.equal(sinceDate("7d", now).toISOString(), "2026-10-23T00:00:00.000Z");
  assert.equal(sinceDate("24h", now).toISOString(), "2026-10-29T00:00:00.000Z");
  assert.throws(() => sinceDate("7 weeks", now));
});

// ------------------------------------------------------------------ audit

test("audit changes PUT full metadata with the flag flipped, then publish", async () => {
  const f = fakeFetch((c) => {
    if (c.method === "GET" && c.url.includes("Attributes(LogicalName='creditlimit')"))
      return { body: { "@odata.context": "x", "@odata.type": "#Microsoft.Dynamics.CRM.MoneyAttributeMetadata", LogicalName: "creditlimit", IsAuditEnabled: { Value: false, CanBeChanged: true } } };
    if (c.method === "PUT" || c.method === "POST") return { status: 204 };
    return undefined;
  });
  const client = new DataverseClient(PROD, fakeTokens, { fetchImpl: f.fn });
  await assert.rejects(setAudit(client, [{ table: "account", column: "creditlimit", on: true }], "", "me", "cli", noLog), PolicyError);
  const logged: ActionEntry[] = [];
  const res = await setAudit(client, [{ table: "account", column: "creditlimit", on: true }], "Finance request", "me", "dashboard", (e) => void logged.push(e));
  assert.equal(res[0]!.ok, true);
  const put = f.calls.find((c) => c.method === "PUT")!;
  const body = JSON.parse(put.body!);
  assert.deepEqual(body.IsAuditEnabled, { Value: true, CanBeChanged: true });
  assert.equal(body["@odata.type"], "#Microsoft.Dynamics.CRM.MoneyAttributeMetadata");
  assert.equal(body["@odata.context"], undefined);
  assert.equal(put.headers["MSCRM.MergeLabels"], "true");
  const pub = f.calls.find((c) => c.url.endsWith("PublishXml"))!;
  assert.match(pub.body!, /<entity>account<\/entity>/);
  assert.equal(logged[0]!.name, "account.creditlimit");
  await assert.rejects(setAudit(client, [{ table: "account'; drop", on: true }], "x y z", "me", "cli", noLog));
});

test("audit history is parsed and can be narrowed to one column", async () => {
  const f = fakeFetch(() => ({ body: { value: [
    { auditid: "a1", createdon: "2026-10-29T14:05:00Z", action: 2, "action@OData.Community.Display.V1.FormattedValue": "Update", _userid_value: "u", "_userid_value@OData.Community.Display.V1.FormattedValue": "Sam", _objectid_value: "o", "_objectid_value@OData.Community.Display.V1.FormattedValue": "Northwind",
      changedata: JSON.stringify({ changedAttributes: [{ logicalName: "creditlimit", oldValue: "25000", newValue: "40000" }, { logicalName: "name", oldValue: "a", newValue: "b" }] }) },
    { auditid: "a2", createdon: "2026-10-29T10:00:00Z", action: 3, changedata: JSON.stringify({ changedAttributes: [{ logicalName: "name", oldValue: "x", newValue: "y" }] }) }
  ] } }));
  const client = new DataverseClient(DEV, fakeTokens, { fetchImpl: f.fn });
  const all = await listAuditEntries(client, "account", new Date("2026-10-01"));
  assert.equal(all.length, 2);
  assert.equal(all[0]!.user, "Sam");
  const one = await listAuditEntries(client, "account", new Date("2026-10-01"), { column: "creditlimit" });
  assert.deepEqual(one.map((e) => e.changes), [[{ column: "creditlimit", old: "25000", new: "40000" }]]);
  assert.match(decodeURIComponent(f.calls[0]!.url), /objecttypecode eq 'account'/);
});

// ------------------------------------------------------------------ user settings

const user = (id: string, s: Record<string, unknown>, onDefaults: boolean): UserRow => ({ id, name: id, login: `${id}@x`, settings: s, onDefaults });
const U1 = "77777777-0000-0000-0000-000000000001";
const U2 = "77777777-0000-0000-0000-000000000002";
const U3 = "77777777-0000-0000-0000-000000000003";

test("plan keeps users who changed their own settings unless overwrite is on", () => {
  const target = { dateformatstring: "dd/MM/yyyy", paginglimit: 50 };
  const users = [user(U1, { dateformatstring: "M/d/yyyy", paginglimit: 50 }, true), user(U2, { dateformatstring: "yyyy-MM-dd" }, false), user(U3, { dateformatstring: "dd/MM/yyyy", paginglimit: 50 }, false)];
  const keep = planApply(users, target, false);
  assert.deepEqual(keep.toChange.map((u) => u.id), [U1]);
  assert.equal(keep.skippedPersonalised, 1);
  assert.equal(keep.alreadyMatching, 1);
  assert.deepEqual(planApply(users, target, true).toChange.map((u) => u.id), [U1, U2]);
});

test("settings are validated", () => {
  assert.deepEqual(validateSettings({ paginglimit: 50, dateformatstring: "dd/MM/yyyy" }), { paginglimit: 50, dateformatstring: "dd/MM/yyyy" });
  assert.throws(() => validateSettings({ paginglimit: 33 }));
  assert.throws(() => validateSettings({ dateformatstring: "<script>" }));
});

test("apply updates each user, optionally the organisation defaults, and logs once", async () => {
  const f = fakeFetch((c) => (c.method === "PATCH" ? (c.url.includes(U2) ? { status: 403, body: { error: { message: "no privilege" } } } : { status: 204 }) : { body: { value: [{ organizationid: "88888888-8888-8888-8888-888888888888", dateformatstring: "M/d/yyyy" }] } }));
  const client = new DataverseClient(PROD, fakeTokens, { fetchImpl: f.fn });
  const plan = planApply([user(U1, {}, true), user(U2, {}, true)], { dateformatstring: "dd/MM/yyyy", timezonecode: 85 }, false);
  await assert.rejects(applyUserSettings(client, plan, { setOrgDefaults: false, source: "cli" }, noLog), PolicyError);
  const logged: ActionEntry[] = [];
  const res = await applyUserSettings(client, plan, { setOrgDefaults: true, reason: "UK standard", actor: "me", source: "dashboard" }, (e) => void logged.push(e));
  assert.equal(res.changed, 1);
  assert.equal(res.failed[0]!.id, U2);
  assert.equal(res.orgDefaultsUpdated, true);
  const orgPatch = f.calls.find((c) => c.method === "PATCH" && c.url.includes("organizations("))!;
  assert.deepEqual(JSON.parse(orgPatch.body!), { dateformatstring: "dd/MM/yyyy" }); // time zone is per user only
  assert.equal(logged.length, 1);
  assert.equal(logged[0]!.ok, false);
});
