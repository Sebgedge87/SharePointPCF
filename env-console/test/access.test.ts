import { test } from "node:test";
import assert from "node:assert/strict";
import { DataverseClient } from "../src/core/dataverse.js";
import { changeState } from "../src/core/components.js";
import { setTraceSetting } from "../src/core/runs.js";
import { accessFrom, AccessError, getAccess, ROLE_TEMPLATES, setExtraRoles } from "../src/core/access.js";
import { PolicyError } from "../src/core/errors.js";
import { DEV, PROD, fakeFetch, fakeTokens } from "./helpers.js";

const ID = "11111111-1111-1111-1111-111111111111";
const role = (name: string, template?: string) => ({ name, _roletemplateid_value: template ?? null });
const userWith = (...roles: ReturnType<typeof role>[]) => fakeFetch((c) => {
  if (c.url.includes("_roletemplateid_value")) return { body: { domainname: "dev@contoso.com", systemuserroles_association: roles } };
  if (c.method !== "GET") return { status: 204 };
  return undefined;
});

test("roles are recognised by template, so renamed or translated roles still count", () => {
  const a = accessFrom("u", { systemuserroles_association: [role("Systemadministrator", ROLE_TEMPLATES.systemAdministrator)] });
  assert.equal(a.isAdmin, true);
  assert.deepEqual(a.can, { admin: true, customize: true });
  const c = accessFrom("u", { teammembership_association: [{ teamroles_association: [role("System Customizer", ROLE_TEMPLATES.systemCustomizer)] }] });
  assert.deepEqual(c.can, { admin: false, customize: true }, "roles through a team count too");
  const b = accessFrom("u", { systemuserroles_association: [role("Basic User", "d2c0b2f1-0000-0000-0000-000000000000")] });
  assert.deepEqual(b.can, { admin: false, customize: false });
});

test("a Basic User can't turn flows off, and nothing is sent", async () => {
  const f = userWith(role("Basic User"));
  const client = new DataverseClient(DEV, fakeTokens, { fetchImpl: f.fn });
  await assert.rejects(changeState(client, { kind: "flow", items: [{ id: ID, name: "A" }], on: false, source: "cli" }, () => {}), (e: Error) => {
    assert.ok(e instanceof AccessError && e instanceof PolicyError);
    assert.match(e.message, /System Administrator or System Customizer role in DEV.*Your roles there: Basic User/);
    return true;
  });
  assert.equal(f.calls.filter((c) => c.method !== "GET").length, 0);
});

test("a System Customizer can change components but not organisation settings", async () => {
  const f = userWith(role("System Customizer", ROLE_TEMPLATES.systemCustomizer));
  const client = new DataverseClient(PROD, fakeTokens, { fetchImpl: f.fn });
  const res = await changeState(client, { kind: "flow", items: [{ id: ID, name: "A" }], on: false, reason: "outage", source: "cli" }, () => {});
  assert.equal(res[0]!.ok, true);
  await assert.rejects(setTraceSetting(client, "all", "debugging", undefined, "cli", () => {}), /System Administrator role in PROD/);
});

test("extra role names from the config also allow changes", async () => {
  const f = userWith(role("Release Manager"));
  const client = new DataverseClient(DEV, fakeTokens, { fetchImpl: f.fn });
  setExtraRoles(client, { customize: ["release manager"] });
  const res = await changeState(client, { kind: "flow", items: [{ id: ID, name: "A" }], on: true, source: "cli" }, () => {});
  assert.equal(res[0]!.ok, true);
});

test("roles are looked up once and reused", async () => {
  const f = userWith(role("System Administrator", ROLE_TEMPLATES.systemAdministrator));
  const client = new DataverseClient(DEV, fakeTokens, { fetchImpl: f.fn });
  await getAccess(client);
  await getAccess(client);
  assert.equal(f.calls.filter((c) => c.url.includes("_roletemplateid_value")).length, 1);
});

test("if roles can't be read, the change is refused", async () => {
  const f = fakeFetch((c) => (c.url.endsWith("WhoAmI") ? { status: 500, body: { error: { message: "down" } } } : { status: 204 }));
  const client = new DataverseClient(DEV, fakeTokens, { fetchImpl: f.fn, maxRetries: 0 });
  await assert.rejects(changeState(client, { kind: "flow", items: [{ id: ID, name: "A" }], on: true, source: "cli" }, () => {}), /Could not check your security roles/);
});
