# 4.0.5

- **Text longer than Excel allows in a cell** (32,767 characters, for example a long list of choice options) no longer stops an export, loading a solution as the model, or converting a metadata export with "Text length must not exceed 32767 characters". The text is cut to fit, ends with `[cut: … this had N]`, and the page lists the cells it cut.
- **Saving no longer stops on a named range.** When rows are inserted for table details, named ranges (including the ones Excel keeps for filters and print titles), formulas on other sheets and charts that point at the sheet move down with the rows. Excel's calculation chain is dropped for Excel to rebuild. Only an Excel table, drawings or comments on the sheet, or a pivot table reading from it, still stop the save.

# 4.0.4

- **The version is shown** when you hover the ? button and at the top of How it works, so you can tell which build you are using.
- **Saving when the original file has gone.** If the linked file has been moved, renamed or deleted (or the browser lost its link to it), Save back to the original file offers **Save as…**: choose where to save the updated workbook, and the page links to that file from then on. Your edits are kept until it is saved.
- **A table with no details at all** (the sheet starts at the field list header): a new detail such as Primary Name Column goes in a row inserted above the header, instead of stopping the save.

# 4.0.3

- **Saving no longer stops when a table detail has no row.** Save to the original file / Download an updated copy insert a row just below the last table detail (for example Primary Name Column or Primary Key) and move everything underneath down: cells, merged cells, dropdown lists, conditional formatting, filters, hyperlinks, page breaks, the frozen header and the sheet's own formulas. If an Excel table, a drawing, comments, a named range or another sheet's formula points at the sheet, nothing is saved and the reason is given, as before.
- **Compare with a solution** (opened as a file): the Dataverse panel takes a solution exported from Power Apps (.zip) and compares the workbook with it, instead of the environment URL, links and saved JSON. Only your own tables are expected in the solution, and a table held as a shell is compared only on its columns. Saved .json files still load if dropped on the page.
- **Publishers and prefixes** (Check ▾): your customisation prefixes (for example cxp, ax, portal) with their publishers, and the prefixes treated as Microsoft's (ms*, adx by default). Used by Checks, new fields and Build solution, which fills in the publisher for the prefix. New check: Prefix not one of yours (info).
- **Build solution never builds a copy of a system field** such as fp_createdon (Dataverse creates createdon on every table). It is listed in the report, and Checks warns: Copy of a system field.
- **Lookups:** changing a field's Attribute Type to Lookup asks which table, then adds `Targets: <table>` to Additional data (and N:1 as the Relationship Type if blank).
- **Sub grid rows** (Attribute Type Sub grid) need no logical name: they are not flagged, counted as fields or built.
- **Back:** a ← button beside the search box, and the browser's Back, Alt+← and a mouse's back button, return to the previous screen.
- Hovering a dropdown, or any text cut short, shows it in full.

# 4.0.2

- **Build a Dataverse solution: Tables only.** A new choice in the dialog, *What to build*: everything (tables, fields and
  relationships, as before) or **Tables only**, which builds each new table with just its primary name column. Fields and
  relationships are left out and listed in build-report.csv; no hand-build list. The choice is remembered per workbook.

# 4.0.1

- **How it works** is laid out as a centred page, with a contents list linking to each section; the five steps sit on one row.
- Tick boxes in side panels are plain tick boxes (no stray border).
- **This environment:** the solution lists are searchable. Your unmanaged solutions come first; managed ones are folded under a
  count and open when you search or click them. Load is greyed out until a solution is picked, then names it.
- **How it works** uses the 4.0 button names (Workbook ▾, Check ▾, Save & share, Build solution) and describes the new ERD panel.

# 4.0.0

Built on 3.0.0 (see [../data-model-explorer-live/CHANGES.md](../data-model-explorer-live/CHANGES.md) for earlier versions).

**Header**
- Fewer, clearer buttons: **Workbook ▾** · **Changes** · **Check ▾** · **Save & share ▾** · **Build solution** · **?**.
- The Workbook menu now holds *Load a newer version of this workbook…*, *Open another workbook…* and, inside an
  environment, *Load from this environment…*, above the workbooks kept in the browser.
- **Check ▾** (was More ▾) has Checks, Compare with Dataverse (or This environment), What changed and Template, and
  shows the number of errors and warnings.
- **Save & share ▾** (was Export ▾) is grouped: Save the workbook, Share, For the build, Logs.
- **Build solution** is its own button, greyed out until a workbook is open.
- The save state reads *kept in browser* (or *not saved: export now*); on narrower screens it becomes a coloured dot.
  The header fits at 1120 px wide; on a phone everything is in the ⋯ menu.

**ERD**
- The side panel lists the tables first (with how many are ticked), then **Show**, with the rest folded under
  **Layout and options**; the line under it sums up what is set, and it stays open or closed as you left it.
- **Tick all shown** / **Untick all shown** appear only while filtering.
- The exports (draw.io, SVG, PNG, Mermaid) are in one **Export ▾** menu above the diagram.

**Read-only copies**
- **Save & share → Download the workbook (.xlsx)**: the workbook the copy was made from, edits written in, formatting
  kept.

**Other**
- An empty page opens on **Start here**: Open workbook…, Download blank template, and inside an environment This
  environment….
- Disabled buttons look disabled.
- Tests: 335. Guide updated, with a new section "The header" and new screenshots.
- `FORMUS_DataModelExplorer_4_0_0_0.zip`: the web resource solution for 4.0.
