# Data Model Explorer 3.0 (live)

Version 2.0, plus the ability to run **inside a Dynamics 365 (Dataverse) environment** and read its tables directly.
Kept in its own folder: 1.9.3 (`../data-model-explorer`) and 2.0 (`../data-model-explorer-v2`) are unchanged.

Opened as a file (double-click `Data_Model_Explorer.html`), it is the same offline page as 2.0. Opened from an
environment as a web resource, it adds an **Environment** panel:

- **Load a solution as the data model.** Pick a solution; the page reads its tables through the Web API (columns,
  types, required levels, choices, number and text settings, lookups with cascade, N:N) and opens them as a model in
  the template layout. Checks, the ERD and every export work on it, and it can be saved as a workbook.
- **Check the workbook against the environment.** Open the design workbook and check it against a solution, or against
  the Default solution filtered to the workbook's tables. It lists what is **undocumented** (tables in the solution,
  custom fields and N:N in the environment but not in the workbook), what is **not built** yet, and **differences** in
  types, required levels, ownership and lookup targets.
- **Managed environments.** Tick *Managed environment* to also find anything made or changed directly in test or
  production: unmanaged tables, fields and N:N, and managed tables and fields with an unmanaged layer on top (with the
  properties changed, where Dataverse reports them).

Everything is read as the signed-in user; nothing is written to the environment. The full guide, with screenshots, is
[`docs/User_Guide.md`](docs/User_Guide.md) (also `docs/User_Guide.docx`), section "Using it inside Dynamics 365".

## Putting it in an environment

`FORMUS_DataModelExplorer_3_0_2_0.zip` in this folder is an unmanaged solution holding the page as one HTML web
resource, `formus_/dme/DataModelExplorer.html` (2.4 MB; the default web resource limit is 5 MB). It uses publisher
unique name `FORMUS`, prefix `formus` and choice value prefix `75047`. **The publisher unique name must match the one
in the environment exactly**, or Dataverse creates a second publisher; to use another, make the zip again:

```
npm run build
python3 tools/make-webresource-solution.py --prefix <prefix> --publisher <publisher unique name> --option-prefix <prefix number>
```

Import it into a development environment first (Power Apps → Solutions → Import, or `pac solution import`), then open
`https://<your-org>.crm.dynamics.com/WebResources/formus_/dme/DataModelExplorer.html`, or add the web resource to an
app's navigation. Opening it in its own browser tab is best: downloads and saving files work as in the offline page.

## Before relying on it

It has been tested against a stand-in for the Dataverse Web API (`tests/live-env.js`), not yet against a real
environment. Things to confirm on the first run:

- the environment's **content security policy** allows the page's inline scripts (only an issue if a strict policy is
  turned on for the environment);
- your **security role** can read solutions, solution components and table definitions;
- the managed-environment check can read **solution layers** (`msdyn_componentlayers`); if it can't, the panel says so
  and still reports unmanaged tables and fields.

## For developers

```
npm install
npm run build          # dist/Data_Model_Explorer.html
npm test               # 321 browser tests; tests/live.js runs the page as a web resource on a stand-in environment
npm run webresource    # the solution zip, from dist/
```

The live code is in `src/index.template.html` under "live: the page running inside a Dataverse environment". It is only
switched on when the page is served from an environment (a `/WebResources/` address, or inside a model-driven app).
