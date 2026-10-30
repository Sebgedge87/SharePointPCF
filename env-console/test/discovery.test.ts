import { test } from "node:test";
import assert from "node:assert/strict";
import { DISCOVERY_URL, discoverEnvironments, suggestName } from "../src/core/discovery.js";

test("short names are suggested from the display name or URL", () => {
  assert.deepEqual(suggestName("Contoso Development", "https://contoso-dev.crm11.dynamics.com"), { name: "DEV", managed: false });
  assert.deepEqual(suggestName("Contoso UAT", "https://contoso-uat.crm11.dynamics.com"), { name: "UAT", managed: true });
  assert.deepEqual(suggestName("Contoso Pre-Prod", "https://contoso-pp.crm11.dynamics.com"), { name: "PREPROD", managed: true });
  assert.deepEqual(suggestName("FormusPro Pre-Production", "https://orgpp01.crm4.dynamics.com"), { name: "PREPROD", managed: true });
  assert.deepEqual(suggestName("FormusPro Preproduction", "https://orgpp02.crm4.dynamics.com"), { name: "PREPROD", managed: true });
  assert.deepEqual(suggestName("FormusPro Testing", "https://orgt.crm4.dynamics.com"), { name: "TEST", managed: true });
  assert.deepEqual(suggestName("FormusPro Production", "https://org.crm4.dynamics.com"), { name: "PROD", managed: true });
  assert.deepEqual(suggestName("Contoso", "https://contoso-prod.crm11.dynamics.com"), { name: "PROD", managed: true });
  assert.deepEqual(suggestName("Contoso", "https://contoso.crm11.dynamics.com"), { name: "CONTOSO", managed: true });
});

test("discovery asks for a token for the discovery service and keeps only Dataverse hosts", async () => {
  let resource = "";
  let auth = "";
  const tokens = { token: async (r: string) => ((resource = r), "tok") };
  const fetchImpl = async (url: string, init: { headers: Record<string, string> }) => {
    auth = init.headers.Authorization!;
    assert.equal(url, `${DISCOVERY_URL}/api/discovery/v2.0/Instances`);
    return {
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({ value: [
          { FriendlyName: "Contoso UAT", UniqueName: "org1", Url: "https://contoso-uat.crm11.dynamics.com/", Region: "UK", State: 0 },
          { FriendlyName: "Old sandbox", UniqueName: "org2", Url: "https://old-dev.crm.dynamics.com", State: 1 },
          { FriendlyName: "Odd", Url: "https://evil.example.com" }
        ] })
    };
  };
  const found = await discoverEnvironments(tokens, fetchImpl);
  assert.equal(resource, DISCOVERY_URL);
  assert.equal(auth, "Bearer tok");
  assert.deepEqual(found.map((f) => [f.friendlyName, f.url, f.enabled, f.suggestedName]), [
    ["Contoso UAT", "https://contoso-uat.crm11.dynamics.com", true, "UAT"],
    ["Old sandbox", "https://old-dev.crm.dynamics.com", false, "DEV"]
  ]);
});
