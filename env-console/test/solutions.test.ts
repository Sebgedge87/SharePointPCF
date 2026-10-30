import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMatrix, compareVersions, filterMatrix, isMicrosoftPublisher, listSolutions, publisherCounts, type Solution } from "../src/core/solutions.js";
import { DataverseClient } from "../src/core/dataverse.js";
import { DEV, fakeFetch, fakeTokens } from "./helpers.js";

const core = { uniqueName: "coreteam", friendlyName: "Core Platform Team", prefix: "core" };
const ms = { uniqueName: "MicrosoftCorporation", friendlyName: "Microsoft Corporation", prefix: "msdyn" };
const sol = (uniqueName: string, version: string, publisher = core, isManaged = true): Solution => ({ id: uniqueName, uniqueName, friendlyName: uniqueName, version, isManaged, publisher });

test("listSolutions maps publisher fields and hides system solutions", async () => {
  const f = fakeFetch(() => ({
    body: {
      value: [
        { solutionid: "1", uniquename: "Default", friendlyname: "Default", version: "1.0", ismanaged: false, publisherid: null },
        { solutionid: "2", uniquename: "CoreCase", friendlyname: "Core Case", version: "2.3.1.0", ismanaged: false, publisherid: { uniquename: "coreteam", friendlyname: "Core Platform Team", customizationprefix: "core" } }
      ]
    }
  }));
  const rows = await listSolutions(new DataverseClient(DEV, fakeTokens, { fetchImpl: f.fn }));
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0]!.publisher, core);
  assert.match(f.calls[0]!.url, /\$expand=publisherid/);
});

test("versions compare numerically", () => {
  assert.equal(compareVersions("1.10.0.0", "1.9.0.0"), 1);
  assert.equal(compareVersions("1.0", "1.0.0.0"), 0);
  assert.equal(compareVersions("2.3.0.1", "2.3.0.2"), -1);
});

test("matrix marks differences and missing installs", () => {
  const rows = buildMatrix(["DEV", "PROD"], {
    DEV: [sol("CoreCase", "2.3.1.0", core, false), sol("Reporting", "1.0.0.1")],
    PROD: [sol("CoreCase", "2.3.0.1"), sol("Same", "1.0")].concat([]),
  });
  const byName = Object.fromEntries(rows.map((r) => [r.uniqueName, r]));
  assert.equal(byName.CoreCase!.differs, true);
  assert.equal(byName.CoreCase!.versions.DEV!.isManaged, false);
  assert.equal(byName.Reporting!.versions.PROD, null);
  assert.equal(byName.Reporting!.differs, true);
  assert.equal(byName.Same!.versions.DEV, null);
});

test("an environment that failed to load is not counted as 'not installed'", () => {
  const rows = buildMatrix(["DEV", "PROD"], { DEV: [sol("A", "1")] });
  assert.equal(rows[0]!.versions.PROD, undefined);
  assert.equal(rows[0]!.differs, false);
});

test("filters: publisher, Microsoft hidden unless asked for, search, diff only", () => {
  const rows = buildMatrix(["DEV", "PROD"], {
    DEV: [sol("CoreCase", "2"), sol("msdyn_Omni", "1", ms), sol("Portal", "3")],
    PROD: [sol("CoreCase", "1"), sol("msdyn_Omni", "1", ms), sol("Portal", "3")]
  });
  assert.deepEqual(filterMatrix(rows, {}).map((r) => r.uniqueName), ["CoreCase", "Portal"]);
  assert.equal(filterMatrix(rows, { includeMicrosoft: true }).length, 3);
  assert.deepEqual(filterMatrix(rows, { publishers: ["MSDYN"] }).map((r) => r.uniqueName), ["msdyn_Omni"]);
  assert.deepEqual(filterMatrix(rows, { publishers: ["Core Platform Team"], diffOnly: true }).map((r) => r.uniqueName), ["CoreCase"]);
  assert.deepEqual(filterMatrix(rows, { search: "port" }).map((r) => r.uniqueName), ["Portal"]);
  assert.equal(isMicrosoftPublisher(ms), true);
  assert.equal(isMicrosoftPublisher(core), false);
  const counts = publisherCounts(rows);
  assert.equal(counts[0]!.publisher.uniqueName, "coreteam");
  assert.equal(counts[0]!.count, 2);
});
