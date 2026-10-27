# 3.0.5

- **Text longer than Excel allows in a cell** (32,767 characters, for example a long list of choice options) no longer stops an export, loading a solution as the model, or converting a metadata export with "Text length must not exceed 32767 characters". The text is cut to fit, ends with `[cut: … this had N]`, and the page lists the cells it cut.
- **Saving no longer stops on a named range.** When rows are inserted for table details, named ranges (including the ones Excel keeps for filters and print titles), formulas on other sheets and charts that point at the sheet move down with the rows. Excel's calculation chain is dropped for Excel to rebuild. Only an Excel table, drawings or comments on the sheet, or a pivot table reading from it, still stop the save.

# 3.0.4

- **The version is shown** when you hover the ? button and at the top of How it works, so you can tell which build you are using.
- **Saving when the original file has gone.** If the linked file has been moved, renamed or deleted (or the browser lost its link to it), Save back to the original file offers **Save as…**: choose where to save the updated workbook, and the page links to that file from then on. Your edits are kept until it is saved.
- **A table with no details at all** (the sheet starts at the field list header): a new detail such as Primary Name Column goes in a row inserted above the header, instead of stopping the save.

# 3.0.3

- **Saving no longer stops when a table detail has no row.** Save to the original file / Download an updated copy insert a row just below the last table detail (for example Primary Name Column or Primary Key) and move everything underneath down: cells, merged cells, dropdown lists, conditional formatting, filters, hyperlinks, page breaks, the frozen header and the sheet's own formulas. If an Excel table, a drawing, comments, a named range or another sheet's formula points at the sheet, nothing is saved and the reason is given, as before.
- **Compare with a solution** (opened as a file): the Dataverse panel takes a solution exported from Power Apps (.zip) and compares the workbook with it, instead of the environment URL, links and saved JSON. Only your own tables are expected in the solution, and a table held as a shell is compared only on its columns. Saved .json files still load if dropped on the page.
- **Publishers and prefixes** (More ▾): your customisation prefixes (for example cxp, ax, portal) with their publishers, and the prefixes treated as Microsoft's (ms*, adx by default). Used by Checks, new fields and Build solution, which fills in the publisher for the prefix. New check: Prefix not one of yours (info).
- **Build solution never builds a copy of a system field** such as fp_createdon (Dataverse creates createdon on every table). It is listed in the report, and Checks warns: Copy of a system field.
- **Lookups:** changing a field's Attribute Type to Lookup asks which table, then adds `Targets: <table>` to Additional data (and N:1 as the Relationship Type if blank).
- **Sub grid rows** (Attribute Type Sub grid) need no logical name: they are not flagged, counted as fields or built.
- **Back:** a ← button beside the search box, and the browser's Back, Alt+← and a mouse's back button, return to the previous screen.
- Hovering a dropdown, or any text cut short, shows it in full.

# 3.0.2

- **Build a Dataverse solution: Tables only.** A new choice in the dialog, *What to build*: everything (tables, fields and
  relationships, as before) or **Tables only**, which builds each new table with just its primary name column. Fields and
  relationships are left out and listed in build-report.csv; no hand-build list. The choice is remembered per workbook.

# 3.0.1

- **How it works** is laid out as a centred page, with a contents list linking to each section; the five steps sit on one row.
- Tick boxes in side panels are plain tick boxes (no stray border).
- **This environment:** the solution lists are searchable. Your unmanaged solutions come first; managed ones are folded under a
  count and open when you search or click them. Load is greyed out until a solution is picked, then names it.

# 3.0.0

Built on 2.0.3 (see [../data-model-explorer-v2/CHANGES.md](../data-model-explorer-v2/CHANGES.md) for earlier versions).

**Inside Dynamics 365**
- When opened from an environment as a web resource, the page reads it through the Dataverse Web API, as the signed-in
  user. The header's Dataverse button becomes **Environment**, and an empty page opens on it.
- **Load a solution as the data model:** the solution's tables (whole tables with all their columns; standard tables added
  as a shell with only the solution's columns), with types, required levels, text, number and date settings, choice
  options and defaults, Yes/No labels, lookup targets, relationship names and cascade, and custom N:N relationships,
  written as a workbook in the template layout and opened like any workbook.
- **Check the workbook against the environment** in one click, against a solution or against the Default solution
  filtered to the workbook's tables. New checks: tables in the solution but not in the workbook, and Dataverse N:N
  relationships not documented.
- **Managed environment check:** unmanaged tables, fields and N:N (created directly in the environment), and managed
  tables and fields carrying an unmanaged ("Active") solution layer, with the properties changed.
- The Dataverse metadata now records whether each table, field and N:N is managed, and their ids.

**Packaging**
- `tools/make-webresource-solution.py` makes an unmanaged solution holding the page as an HTML web resource, in the layout
  `pac solution pack` writes (checked by unpacking and re-packing with pac 2.14). The web resource keeps the same id on
  every build, so importing a new version updates it. `FORMUS_DataModelExplorer_3_0_0_0.zip` is included.

**Other**
- `loadFile` now reports when a file has finished opening (used by the solution loader).
- Tests: `tests/live.js` (28 checks on a stand-in environment, `tests/live-env.js`) and `tests/webresource.js`. 321 tests
  in all.
- User guide: new section "Using it inside Dynamics 365", with three screenshots (`tools/live-screenshots.js`).
