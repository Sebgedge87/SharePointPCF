# Data Model Explorer 4.0

Version 3.0 (live) with a **simpler header** and an **Excel download in read-only copies**. Kept in its own folder:
1.9.3 (`../data-model-explorer`), 2.0 (`../data-model-explorer-v2`) and 3.0 (`../data-model-explorer-live`) are unchanged.

## What's different from 3.0

The header now has fewer buttons, in the order you work:

| 4.0 | Replaces (3.0) |
| --- | --- |
| **Workbook ▾** (the file's name): load a newer version, open another, switch | Open workbook…, Load version…, the workbook selector |
| **Changes**, with *kept in browser* beside it | Changes, Saved |
| **Check ▾**: Checks, Compare with Dataverse / This environment, What changed, Template | More ▾ |
| **Save & share ▾**, grouped: Save the workbook · Share · For the build · Logs | Export ▾ |
| **Build solution** (greyed out until a workbook is open) | Export → Dataverse solution |
| **?** | How it works |

A **read-only copy** now has **Save & share → Download the workbook (.xlsx)**: the workbook it was made from, with the
edits written in and its formatting kept. An empty page opens on **Start here**, with Open workbook… and Download blank
template side by side.

The **ERD** side panel shows the tables first and folds the layout options away under *Layout and options*; its exports
are in one *Export ▾* menu.

Everything else (the ERD, checks, the solution builder, and reading a Dynamics 365 environment when uploaded as a web
resource) works as in 3.0. The full guide, with screenshots, is [`docs/User_Guide.md`](docs/User_Guide.md) (also
`docs/User_Guide.docx`).

## Putting it in an environment

`FORMUS_DataModelExplorer_4_0_1_0.zip` in this folder is an unmanaged solution holding the page as one HTML web
resource, `formus_/dme/DataModelExplorer.html` (2.4 MB; the default web resource limit is 5 MB), with publisher unique
name `FORMUS`, prefix `formus` and choice value prefix `75047`. It uses the same web resource name and id as 3.0, so
importing it into an environment that has 3.0 replaces 3.0 there. **The publisher unique name must match the one in the
environment exactly**; to use another, make the zip again:

```
npm run build
python3 tools/make-webresource-solution.py --prefix <prefix> --publisher <publisher unique name> --option-prefix <prefix number>
```

Then open `https://<your-org>.crm.dynamics.com/WebResources/formus_/dme/DataModelExplorer.html`. See the 3.0 README
(`../data-model-explorer-live/README.md`) for what to confirm on the first run in a real environment.

## For developers

```
npm install
npm run build          # dist/Data_Model_Explorer.html
npm test               # 335 browser tests, including the page as a web resource on a stand-in environment
npm run webresource    # the solution zip, from dist/
```
