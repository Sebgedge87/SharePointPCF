import { test } from "node:test";
import assert from "node:assert/strict";
import { environmentFromUrl, uniqueShortName, Workspace } from "../src/core/environments.js";
import type { PcxConfig } from "../src/core/config.js";
import { fakeFetch, fakeTokens } from "./helpers.js";

const orgName = (name: string | null) =>
  fakeFetch((c) => (c.url.includes("RetrieveCurrentOrganization") ? (name ? { body: { Detail: { FriendlyName: name } } } : { status: 401, body: { error: { message: "no" } } }) : undefined));

test("short names are made unique", () => {
  assert.equal(uniqueShortName("UAT", ["DEV", "uat"]), "UAT-2");
  assert.equal(uniqueShortName("Formus Pro!", []), "FORMUS-PRO");
});

test("adding by URL looks up the name and suggests short name and type", async () => {
  const config: PcxConfig = { auth: { provider: "azps" }, environments: [{ name: "DEV", url: "https://a-dev.crm4.dynamics.com", managed: false }] };
  const ws = new Workspace(config, fakeTokens, { fetchImpl: orgName("FormusPro Development 2").fn });
  const env = await environmentFromUrl(ws, "https://org9b818508.crm4.dynamics.com/main.aspx?appid=1");
  assert.deepEqual(env, { name: "DEV-2", label: "FormusPro Development 2", url: "https://org9b818508.crm4.dynamics.com", managed: false });

  const ws2 = new Workspace(config, fakeTokens, { fetchImpl: orgName("FormusPro UAT").fn });
  assert.deepEqual(await environmentFromUrl(ws2, "https://orgabc.crm4.dynamics.com"), { name: "UAT", label: "FormusPro UAT", url: "https://orgabc.crm4.dynamics.com", managed: true });
  assert.equal((await environmentFromUrl(ws2, "https://orgabc.crm4.dynamics.com", { managed: false })).managed, false);
});

test("if the name can't be read (not signed in yet) the host is used", async () => {
  const config: PcxConfig = { auth: { provider: "azps" }, environments: [] };
  const env = await environmentFromUrl(new Workspace(config, fakeTokens, { fetchImpl: orgName(null).fn }), "https://orgc98ad8b7.crm4.dynamics.com");
  assert.equal(env.label, "orgc98ad8b7");
  assert.equal(env.name, "ORGC98AD8B7");
});

test("the same URL can't be added twice, and only Dataverse hosts are accepted", async () => {
  const config: PcxConfig = { auth: { provider: "azps" }, environments: [{ name: "DEV", url: "https://a-dev.crm4.dynamics.com", managed: false }] };
  const ws = new Workspace(config, fakeTokens, { fetchImpl: orgName("x").fn });
  await assert.rejects(environmentFromUrl(ws, "https://a-dev.crm4.dynamics.com/"), /already in the console/);
  await assert.rejects(environmentFromUrl(ws, "https://evil.example.com"), /not a Dataverse host/);
});
