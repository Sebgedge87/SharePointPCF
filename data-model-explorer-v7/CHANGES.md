# 7.0.0

New folder (`data-model-explorer-v7`), from 6.0.1.

- **Dark mode.** The page follows the system's light or dark setting. The theme button in the header (beside ?) cycles Automatic, Dark and Light, and the choice is kept in the browser. The ERD on the page follows the theme; exported ERD images and draw.io files keep their light colours.
- **Generic.** No company logo or name anywhere: the page, the guide, the template (its comment columns are now **Comments**), the example workbook (prefix `sample_`), the Dynamics 365 solution (`DataModelExplorer_7_0_0_0.zip`, publisher `DataModelExplorer`, prefix `dme`, so the page opens at `/WebResources/dme_/dme/DataModelExplorer.html`) and the XrmToolBox tool (`DataModelExplorer.XrmToolBox.dll`).
- **XrmToolBox:** the tool's file name changed, so remove the 6.0 tool's dll from the Plugins folder when installing this one, or both appear in the tool list.

# 6.0.1

- **This environment: one solution list.** One searchable list of solutions; under it, **Load … as the model** and **Check against …**, both naming the solution picked. The Default solution (the workbook's own tables) is at the top of the list, for checking.
- The XrmToolBox tool is rebuilt with this page (`xrmtoolbox/release`, 6.0.1).

# 6.0.0

- The ERD's table filter suggests your own prefix (from Publishers and prefixes, or the workbook's), not `rhs_`.
- **Text longer than Excel allows in a cell** (32,767 characters, for example a long list of choice options) no longer stops an export, loading a solution as the model, or converting a metadata export with "Text length must not exceed 32767 characters". The text is cut to fit, ends with `[cut: … this had N]`, and the page lists the cells it cut.
- **Save & share is simpler.** **Save** (`Ctrl`+`S`) writes your edits into your workbook, asking where only the first time (or after the file has moved), and no longer asks "Overwrite the original file?" each time; it still asks if another program changed the file. **Save as…** saves to a new file. The template and values-only exports are under **Other formats**, and the two CSV items are one, with an **include hidden columns** tick box.
- **Separate web resources in Dataverse.** The solution zip (6.0.0) holds the page (`DataModelExplorer.html`, 0.2 MB), its code (`app.js`) and the libraries (`lib/xlsx.full.min.js`, `lib/exceljs.min.js`, `lib/jszip.min.js`) as five web resources. A new version replaces only what changed and the libraries stay cached. The page keeps 5.0's name and id, so importing over 5.0 updates it. `make-webresource-solution.py --single` still packages one file.
- Opened as a file, and in XrmToolBox, the page is still one file (`Data_Model_Explorer.html`), built from the same source.
- **A red bar** says when a part of the page did not load, or the parts are from different versions (an unfinished import, or an old copy in the browser's cache), and what to do.
- A read-only copy made inside Dynamics 365 has the code and libraries written in, so it is still one file.
- **Saving no longer stops on a named range** (as in 5.0.5): named ranges, filters, print titles, other sheets' formulas and charts move with inserted rows.
- **XrmToolBox:** saving no longer shows the browser's own permission box (as in 5.0.5).

# 5.0.4

- **The version is shown** when you hover the ? button and at the top of How it works, so you can tell which build you are using.
- **Saving when the original file has gone.** If the linked file has been moved, renamed or deleted (or the browser lost its link to it), Save back to the original file offers **Save as…**: choose where to save the updated workbook, and the page links to that file from then on. Your edits are kept until it is saved.
- **A table with no details at all** (the sheet starts at the field list header): a new detail such as Primary Name Column goes in a row inserted above the header, instead of stopping the save.
- The XrmToolBox tool is rebuilt with this page (`xrmtoolbox/release`, 5.0.4).

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
