import { test } from "node:test";
import assert from "node:assert/strict";
import { ConfigError, normaliseEnvUrl, validateConfig } from "../src/core/config.js";

test("environment URLs are normalised to their origin", () => {
  assert.equal(normaliseEnvUrl("https://Org.CRM11.dynamics.com/main.aspx?x=1"), "https://org.crm11.dynamics.com");
});

test("non-Dataverse, http and credential URLs are refused", () => {
  assert.throws(() => normaliseEnvUrl("https://evil.example.com"), ConfigError);
  assert.throws(() => normaliseEnvUrl("http://org.crm.dynamics.com"), ConfigError);
  assert.throws(() => normaliseEnvUrl("https://a:b@org.crm.dynamics.com"), ConfigError);
  assert.throws(() => normaliseEnvUrl("https://org.crm.dynamics.com:8443"), ConfigError);
  assert.throws(() => normaliseEnvUrl("https://dynamics.com.evil.io"), ConfigError);
});

test("extra host suffixes can be allowed for sovereign clouds", () => {
  const c = validateConfig({ allowedHostSuffixes: [".crm.example.gov"], environments: [{ name: "GOV", url: "https://x.crm.example.gov" }] });
  assert.equal(c.environments[0]!.url, "https://x.crm.example.gov");
});

test("environments default to managed; names must be unique and simple", () => {
  const c = validateConfig({ environments: [{ name: "DEV", url: "https://d.crm.dynamics.com", managed: false }, { name: "PROD", url: "https://p.crm.dynamics.com" }] });
  assert.equal(c.environments[0]!.managed, false);
  assert.equal(c.environments[1]!.managed, true);
  assert.equal(c.auth.provider, "azps");
  assert.throws(() => validateConfig({ environments: [{ name: "dev", url: "https://d.crm.dynamics.com" }, { name: "DEV", url: "https://e.crm.dynamics.com" }] }), /Duplicate/);
  assert.throws(() => validateConfig({ environments: [{ name: "bad name", url: "https://d.crm.dynamics.com" }] }), ConfigError);
});

test("tenant and provider are validated", () => {
  assert.throws(() => validateConfig({ tenantId: "x; rm -rf /" }), ConfigError);
  assert.throws(() => validateConfig({ auth: { provider: "pac" } }), ConfigError);
  assert.equal(validateConfig({ tenantId: "contoso.onmicrosoft.com" }).tenantId, "contoso.onmicrosoft.com");
});
