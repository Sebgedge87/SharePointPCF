import { test } from "node:test";
import assert from "node:assert/strict";
import { DataverseClient, DataverseError } from "../src/core/dataverse.js";
import { DEV, fakeFetch, fakeTokens } from "./helpers.js";

test("requests carry the bearer token and OData headers", async () => {
  const f = fakeFetch(() => ({ body: { UserId: "u" } }));
  const c = new DataverseClient(DEV, fakeTokens, { fetchImpl: f.fn });
  await c.get("WhoAmI");
  assert.equal(f.calls[0]!.url, "https://org-dev.crm11.dynamics.com/api/data/v9.2/WhoAmI");
  assert.equal(f.calls[0]!.headers.Authorization, "Bearer test-token");
  assert.equal(f.calls[0]!.headers["OData-Version"], "4.0");
});

test("getAll follows nextLink within the same environment only", async () => {
  const base = "https://org-dev.crm11.dynamics.com/api/data/v9.2/";
  const f = fakeFetch((c) => {
    if (c.url === base + "solutions") return { body: { value: [1, 2], "@odata.nextLink": base + "solutions?$skiptoken=2" } };
    if (c.url === base + "solutions?$skiptoken=2") return { body: { value: [3] } };
    return undefined;
  });
  const c = new DataverseClient(DEV, fakeTokens, { fetchImpl: f.fn });
  assert.deepEqual(await c.getAll("solutions"), [1, 2, 3]);

  const evil = fakeFetch(() => ({ body: { value: [1], "@odata.nextLink": "https://attacker.example.com/api/data/v9.2/x" } }));
  const c2 = new DataverseClient(DEV, fakeTokens, { fetchImpl: evil.fn });
  await assert.rejects(c2.getAll("solutions"), /outside/);
  assert.equal(evil.calls.length, 1);
});

test("unsafe relative paths are refused", () => {
  const c = new DataverseClient(DEV, fakeTokens, { fetchImpl: fakeFetch(() => undefined).fn });
  assert.throws(() => c.url("https://x.com/a"));
  assert.throws(() => c.url("/api/data"));
  assert.throws(() => c.url("../../x"));
});

test("429 is retried using Retry-After, then succeeds", async () => {
  let n = 0;
  const waits: number[] = [];
  const f = fakeFetch(() => (n++ === 0 ? { status: 429, headers: { "Retry-After": "2" } } : { body: { ok: 1 } }));
  const c = new DataverseClient(DEV, fakeTokens, { fetchImpl: f.fn, sleep: async (ms) => void waits.push(ms) });
  assert.deepEqual(await c.get("x"), { ok: 1 });
  assert.deepEqual(waits, [2000]);
});

test("errors carry the Dataverse message", async () => {
  const f = fakeFetch(() => ({ status: 403, body: { error: { code: "0x80040220", message: "Principal user is missing prvWriteWorkflow" } } }));
  const c = new DataverseClient(DEV, fakeTokens, { fetchImpl: f.fn });
  await assert.rejects(c.get("x"), (e: unknown) => e instanceof DataverseError && e.status === 403 && /prvWriteWorkflow/.test(e.message));
});

test("update uses If-Match so a wrong ID never creates a row", async () => {
  const f = fakeFetch(() => ({ status: 204 }));
  const c = new DataverseClient(DEV, fakeTokens, { fetchImpl: f.fn });
  await c.update("workflows", "11111111-2222-3333-4444-555555555555", { statecode: 1 });
  assert.equal(f.calls[0]!.method, "PATCH");
  assert.equal(f.calls[0]!.headers["If-Match"], "*");
  assert.equal(f.calls[0]!.body, '{"statecode":1}');
  await assert.rejects(c.update("workflows", "not-a-guid", {}));
});
