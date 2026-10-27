# 5.0.3

- **Saving no longer stops when a table detail has no row.** Save to the original file / Download an updated copy insert a row just below the last table detail (for example Primary Name Column or Primary Key) and move everything underneath down: cells, merged cells, dropdown lists, conditional formatting, filters, hyperlinks, page breaks, the frozen header and the sheet's own formulas. If an Excel table, a drawing, comments, a named range or another sheet's formula points at the sheet, nothing is saved and the reason is given, as before.
- **Compare with a solution** (opened as a file): the Dataverse panel takes a solution exported from Power Apps (.zip) and compares the workbook with it, instead of the environment URL, links and saved JSON. Only your own tables are expected in the solution, and a table held as a shell is compared only on its columns. Saved .json files still load if dropped on the page.
- **Publishers and prefixes** (Check ▾): your customisation prefixes (for example cxp, ax, portal) with their publishers, and the prefixes treated as Microsoft's (ms*, adx by default). Used by Checks, new fields and Build solution, which fills in the publisher for the prefix. New check: Prefix not one of yours (info).
- **Build solution never builds a copy of a system field** such as fp_createdon (Dataverse creates createdon on every table). It is listed in the report, and Checks warns: Copy of a system field.
- **Lookups:** changing a field's Attribute Type to Lookup asks which table, then adds `Targets: <table>` to Additional data (and N:1 as the Relationship Type if blank).
- **Sub grid rows** (Attribute Type Sub grid) need no logical name: they are not flagged, counted as fields or built.
- **Back:** a ← button beside the search box, and the browser's Back, Alt+← and a mouse's back button, return to the previous screen.
- Hovering a dropdown, or any text cut short, shows it in full.
- The XrmToolBox tool is rebuilt with this page (`xrmtoolbox/release`, 5.0.3).

# 5.0.2

- **Build a Dataverse solution: Tables only.** A new choice in the dialog, *What to build*: everything (tables, fields and
  relationships, as before) or **Tables only**, which builds each new table with just its primary name column. Fields and
  relationships are left out and listed in build-report.csv; no hand-build list. The choice is remembered per workbook.
- The XrmToolBox tool is rebuilt with this page (`xrmtoolbox/release`, 5.0.2).

# 5.0.1

- **How it works** is laid out as a centred page, with a contents list linking to each section; the five steps sit on one row.
- Tick boxes in side panels are plain tick boxes (no stray border).
- **This environment:** the solution lists are searchable. Your unmanaged solutions come first; managed ones are folded under a
  count and open when you search or click them. Load is greyed out until a solution is picked, then names it.
- **How it works** uses the 4.0 button names (Workbook ▾, Check ▾, Save & share, Build solution) and describes the new ERD panel.
- The XrmToolBox tool is rebuilt with this page (`xrmtoolbox/release`, 5.0.1).

# 5.0.0

Built on 4.0.0 (see [../data-model-explorer-v4/CHANGES.md](../data-model-explorer-v4/CHANGES.md) for earlier versions).
The page is the same as 4.0.

**XrmToolBox tool** (`xrmtoolbox/`)
- Opens the page in WebView2 inside XrmToolBox, on the environment XrmToolBox is connected to, so it runs as it does
  inside Dynamics 365: load a solution as the model, check a workbook against the environment, managed-environment check.
- The page is built into the dll. Its Web API requests are sent on with XrmToolBox's access token (refreshed as
  needed); only read (GET) requests are passed on.
- Changing the connection reopens the page on the new environment. Workbooks, edits and ERD layouts are kept in a
  browser profile in XrmToolBox's settings folder.
- Built against XrmToolBox 1.2025.10.74 (with MscrmTools.Xrm.Connection 1.2025.9.64 and WebView2 1.0.3351.48, the
  versions XrmToolBox ships). `deploy.ps1` builds and installs it; `DataModelExplorer.XrmToolBox.nuspec` packs it for
  the Tool Library.
- Checked by compiling against those libraries; not yet run inside XrmToolBox.

**Other**
- User guide: new section "Using it in XrmToolBox".
- `FORMUS_DataModelExplorer_5_0_0_0.zip`: the web resource solution, as in 4.0.
