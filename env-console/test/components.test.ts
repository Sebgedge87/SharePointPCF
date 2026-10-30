import { test } from "node:test";
import assert from "node:assert/strict";
import { changeState, listComponents, PolicyError, selectComponents, statePatch, type ComponentItem } from "../src/core/components.js";
import type { ActionEntry } from "../src/core/actionLog.js";
import { DataverseClient } from "../src/core/dataverse.js";
import { DEV, PROD, fakeFetch, fakeTokens } from "./helpers.js";

const ID1 = "11111111-1111-1111-1111-111111111111";
const ID2 = "22222222-2222-2222-2222-222222222222";

test("on/off maps to the right state and status codes", () => {
  assert.deepEqual(statePatch("flow", true), { entitySet: "workflows", body: { statecode: 1, statuscode: 2 } });
  assert.deepEqual(statePatch("rule", false), { entitySet: "workflows", body: { statecode: 0, statuscode: 1 } });
  assert.deepEqual(statePatch("plugin", true), { entitySet: "sdkmessageprocessingsteps", body: { statecode: 0, statuscode: 1 } });
  assert.deepEqual(statePatch("plugin", false), { entitySet: "sdkmessageprocessingsteps", body: { statecode: 1, statuscode: 2 } });
});

test("flows are read from workflows with category 5; plugin steps describe table, message and stage", async () => {
  const f = fakeFetch((c) => {
    if (c.url.includes("workflows")) return { body: { value: [{ workflowid: ID1, name: "SAP order sync", statecode: 1, primaryentity: "salesorder" }] } };
    return {
      body: { value: [{ sdkmessageprocessingstepid: ID2, name: "AccountPreUpdate", statecode: 1, stage: 20, mode: 0, sdkmessageid: { name: "Update" }, sdkmessagefilterid: { primaryobjecttypecode: "account" } }] }
    };
  });
  const client = new DataverseClient(DEV, fakeTokens, { fetchImpl: f.fn });
  const flows = await listComponents(client, "flow");
  assert.ok(f.calls.some((c) => /category eq 5 and type eq 1/.test(decodeURIComponent(c.url))));
  assert.deepEqual(flows[0], { id: ID1, kind: "flow", name: "SAP order sync", on: true, target: "salesorder", modifiedOn: undefined, custom: true, solution: undefined, managed: undefined });
  const steps = await listComponents(client, "plugin");
  assert.equal(steps[0]!.on, false);
  assert.equal(steps[0]!.target, "account · Update · Pre-operation · sync");
});

test("managed environments need a reason; nothing is sent without one", async () => {
  const f = fakeFetch(() => ({ status: 204 }));
  const client = new DataverseClient(PROD, fakeTokens, { fetchImpl: f.fn });
  await assert.rejects(changeState(client, { kind: "flow", items: [{ id: ID1, name: "A" }], on: false, source: "cli" }, () => {}), PolicyError);
  assert.equal(f.calls.length, 0);
});

test("changes are made one by one, partial failures reported, every attempt logged", async () => {
  const f = fakeFetch((c) => (c.method === "GET" ? undefined : c.url.includes(ID2) ? { status: 403, body: { error: { message: "no privilege" } } } : { status: 204 }));
  const client = new DataverseClient(PROD, fakeTokens, { fetchImpl: f.fn });
  const logged: ActionEntry[] = [];
  const res = await changeState(client, { kind: "plugin", items: [{ id: ID1, name: "A" }, { id: ID2, name: "B" }], on: false, reason: "SAP outage", actor: "me", source: "dashboard" }, (e) => void logged.push(e));
  assert.deepEqual(res.map((r) => r.ok), [true, false]);
  assert.match(res[1]!.error!, /no privilege/);
  assert.equal(logged.length, 2);
  assert.equal(logged[0]!.reason, "SAP outage");
  assert.equal(logged[0]!.env, "PROD");
  assert.equal(logged[1]!.ok, false);
  assert.equal(f.calls.filter((c) => c.method !== "GET")[0]!.url, `https://org.crm11.dynamics.com/api/data/v9.2/sdkmessageprocessingsteps(${ID1})`);
});

test("unmanaged DEV needs no reason", async () => {
  const f = fakeFetch((c) => (c.method === "GET" ? undefined : { status: 204 }));
  const res = await changeState(new DataverseClient(DEV, fakeTokens, { fetchImpl: f.fn }), { kind: "flow", items: [{ id: ID1, name: "A" }], on: true, source: "cli" }, () => {});
  assert.equal(res[0]!.ok, true);
});

test("selection by name, ID, filter or all", () => {
  const all: ComponentItem[] = [
    { id: ID1, kind: "flow", name: "SAP order sync", on: true, target: "", custom: true },
    { id: ID2, kind: "flow", name: "SAP invoice sync", on: true, target: "", custom: true },
    { id: "33333333-3333-3333-3333-333333333333", kind: "flow", name: "Digest", on: true, target: "", custom: true }
  ];
  assert.equal(selectComponents(all, { filter: "sap" }).length, 2);
  assert.equal(selectComponents(all, { names: ["digest"] })[0]!.name, "Digest");
  assert.equal(selectComponents(all, { names: [ID2] })[0]!.name, "SAP invoice sync");
  assert.equal(selectComponents(all, { all: true }).length, 3);
  assert.throws(() => selectComponents(all, { names: ["nope"] }), /No component/);
});
