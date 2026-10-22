# 1.9.1

Solution import fixes (the first real import failed: "Entity Display Collection Name ... not specified")
- A table's plural name is written as `<LocalizedCollectionName>` (it was `<LocalizedName>`), which Dataverse needs to
  create the table.
- Compared element by element with solutions exported by Dataverse (Microsoft's CoE Starter Kit), and brought in line:
  one-to-many relationships carry `CascadeArchive`; N:N relationships have no description and number their roles
  (`AssociationRoleOrdinal` 1 and 2); table settings use the exported names and order (`CanModifyMobileClientOffline`,
  `CanCreateAttributes/Forms/Charts/Views`, `IconVectorName`, `EntityHelpUrl`; no `MobileOfflineEnabled`);
  `HasRelatedNotes` is written only when notes are on; multi-line text has no `Length` and uses format `text`;
  multi-select choices have no `AppDefaultValue`; option sets carry `ExternalValue`/`IsHidden` on every option and
  `ExternalTypeName` on Yes/No.
- **Has Activities** is not a setting in the solution file: a table with it set is listed in the build report as a
  step to do by hand after import (turn on Activities in the table's properties).
- `tests/compare_xml.py` repeats the comparison against exported files.

# 1.9.0

- **Export → Import script (import.ps1)**, and **Import script only** in the solution dialog: the PowerShell import
  script on its own, for a solution zip you already have. Put it next to the zip and run it; it imports the one
  solution zip in its folder, or the one given with `-SolutionPath`.
- import.ps1 (also the one in the build zip) takes `-SolutionPath`, prints which solution it imports, writes solution
  checker results next to the solution, uses Windows line endings, and says to run `Unblock-File .\import.ps1` if
  Windows refuses to run a downloaded script. Both versions are parsed with PowerShell 7.4 and run against a stand-in
  pac in testing.

# 1.8.1

- The Relationship Name column is hidden by default, also where column choices were saved before: it is optional, as
  the solution generator names each relationship when it is blank. Columns ▾ shows it again; a name typed there is
  still used.

# 1.8.0

Primary key and table details
- The primary key is marked: a **Primary key** tag on its row in the field list, and in the table header. When the
  workbook doesn't record it, the table name followed by id is shown as "(assumed)"; a missing primary name column
  shows as "not set".
- **Set as primary key** and **Set as primary name** on any field's detail panel record it in the table details.
- **✎ Table details** in the table header edits every detail row (primary name column, primary key, ownership,
  notes, activities and the rest), including details the template has but the table lacks.
- Changed details are kept with your edits, listed under "Table details" in Changes (with revert), carried to newer
  versions, and written by every export. Saving back to the original writes a detail beside its label; a detail the
  sheet lacks goes in an empty row above the field list, and the save is refused if there is none.
- New check: a primary key that isn't a unique identifier (Dataverse keys are always GUIDs; use an alternate key to
  keep another field unique). The solution generator leaves such a table out, with the reason.

Naming downloads
- Downloading a new copy of the workbook (updated copy, template format, plain values) first asks for the file name.
  It suggests the next version (Model v1.2 -> Model v1.3, Model 1.4 -> Model 1.5), or adds "(updated)" / "(edited)".

# 1.7.0

Adding rows
- **＋ Add field** on a table page adds a field, a lookup or an N:N relationship to the end of its field list. The
  dialog suggests the logical and schema names from the display name with your prefix, asks for the related table for
  a lookup or N:N, fills in Targets and the Relationship Type (N:1 / N:N), and refuses a name already in the table.
  The new row then opens in the detail panel for everything else. Other sheets (the Table Dictionary) get
  **＋ Add row**, which adds a blank row.
- Added rows are tagged ADDED, saved in the browser with your edits, checked, drawn in the ERD and included in the
  Dataverse solution. They are listed under "Rows added" in Changes and can be removed there or from their panel;
  Revert all removes them.
- Saving back to the original (or downloading an updated copy) writes added rows into the empty rows after the field
  list. Nothing is inserted or moved; if a Forms/Views section leaves too few empty rows, the save is refused and the
  template export is suggested. The template export simply lists them after the existing fields.
- Carried to a newer version like edits. If the newer version already has a field with the same logical name, you
  choose whether to keep the new version's or add yours as well.

Columns from the template
- Columns the template has but a workbook lacks (for example Relationship Type, Relationship Name and Cascade Delete
  in a workbook made before 1.6.0) are added to the page, marked "added", and listed in the Template panel. Their header
  (and the template's hint) is written into the file with the first value saved in them, styled like the neighbouring
  column. Unused added columns are not written.

# 1.6.1

- How it works: the introduction and the step overview now include building the model in Dataverse (step 5).
- README: a step-by-step guide to using the page and building a solution, and the template rows and columns it needs.

# 1.6.0

Build a Dataverse solution
- **Export → Dataverse solution (.zip)…**: a dialog for the solution name, version and publisher (prefix and choice
  value prefix suggested from the workbook) shows what will and won't be built, then downloads one zip with:
  - the unmanaged **solution**: new tables (primary name column, primary key, ownership, notes/activities, audit) and
    their fields; your fields on existing tables, included as shells holding only those fields; a 1:N relationship for
    each lookup (two for a customer lookup); an N:N relationship for each N:N row. Field settings carry over: text
    length and format, memo length, number ranges and precision, currency precision, date format and behaviour,
    Yes/No labels and default, choice options with their values and default, required level, field security.
  - **import.ps1**: checks for pac and installs it (dotnet tool, or winget on Windows), signs in through the browser,
    optionally runs the solution checker (-Check), and imports with `pac solution import --publish-changes --async`.
  - **build-report.csv**: everything included, left out (with the reason) or to build by hand.
  - the **hand-build list** of calculated and rollup fields, and a README.
- Not built (listed instead): calculated/rollup fields, activity tables, multi-table lookups, image and file fields,
  choice fields without options, and lookups to a table that isn't in the solution.
- On the full RHS export: 134 new tables, 16 existing tables, 2,399 fields, 417 relationships, in under a second.
  Microsoft's SolutionPackager unpacks and re-packs the result.

Workbook and template
- Template table details gain **Primary Name Column, Primary Key, Is Activity, Has Notes, Has Activities**; the field
  list gains **Relationship Type** (N:1 / N:N), **Relationship Name** and **Cascade Delete**, with dropdowns.
- Converting a Metadata Document Generator export fills the new table details from its Entities list.
- Table pages show the primary name and key; the primary name row and N:N rows are tagged in the grid.
- A lookup counts as a recorded relationship when Relationship Type is N:1 (the ERD then draws its ends); N:N rows
  are drawn in the ERD.
- New checks: missing / unlisted / non-text primary name column; invalid Relationship Type; unrecognised Cascade
  Delete; N:N rows without exactly one other table; duplicate relationship names.

# 1.5.0

- **To build by hand:** calculated, rollup and formula fields of your own (their definitions aren't in the workbook,
  so they can't go in a generated solution) are listed per table in **Export → Calculated and rollup fields
  (.xlsx)**: Summary, By table (a heading per table, with blank Formula and Created? columns) and a filterable All
  fields sheet. Also an Overview card and a Checks entry per field.
- **ERD relationships of unknown type:** a line only shows relationship ends (one / many) when the relationship is
  recorded (for now, by imported Dataverse metadata). Otherwise it is a plain grey line with no ends or arrow, in
  the diagram and the draw.io export; the info bar counts them and Checks lists them per table under
  "Relationship type not recorded" for review.
- **Template changes:** table-detail rows are read however many there are (they were limited to the first nine), so
  new detail rows such as "Primary Name Column" can be added to the template. New field columns were already read.

# 1.4.0

Areas (from the Table Dictionary's Area column)
- ERD: **Area ▾** picks one or more areas. The table list narrows to them and their tables are drawn (asking first
  above 80 tables). Tables they look up in other areas still appear as referenced boxes. **Colour by area** gives
  each area its own border colour, with a legend, also in the draw.io export.
- Checks and All fields: **Area ▾** filters to one or more areas; the Overview's "By area" issue counts open
  Checks filtered to that area.
- Editing Area in the Table Dictionary regroups the sidebar, ERD and filters straight away (it used to need a
  reload).
- The area controls appear when the workbook has at least two areas; otherwise the ERD says to fill in Area in the
  Table Dictionary.

Other
- A converted Metadata Document Generator export keeps the export's own file name (no "(converted)").
- The first workbook opened is no longer compared with the empty starter template (it showed a meaningless
  "What changed").

# 1.3.0 (interface review)

Overview
- Checks are shown with the severity of their actual findings (it had shown "Warning · 1,304" for lookups that are
  info). The unresolved-lookups tile counts only those that need attention and notes the rest
  ("9 · 1,304 to standard tables (info)").
- Tiles that open something show → and react on hover; plain tiles don't.

ERD
- Opens with the custom tables only when there are 30 or fewer (otherwise every table if 30 or fewer, otherwise
  nothing) and a prompt explaining how to pick a readable set. Asks before drawing more than 80 tables.

Colour, text and links
- Body text is a neutral dark grey; navy is kept for headings and links, and links are underlined.
- Errors are red, warnings amber, info grey (pink stays the brand and edit colour).
- The faint grey is darker (5.2:1 on white, 4.6:1 on grey panels, passing WCAG AA); the ★ is 3:1 or better.
- Small text raised from 11 px to 12 px; filter, row-expand and ★ buttons have larger hit areas.
- What changed marks additions with + and removals with −, and no longer repeats a lookup change as a raw
  Additional data change when the relationship line already explains it.

Header and menus
- Search box at least 260 px; the file name under the title is gone (the workbook selector shows it);
  "Load updated version…" is now "Load version…".
- Export holds only exports. "Discard all edits" stays in Changes (Revert all); "Go back to the empty template"
  moved to Manage files. The unexplained badge on More is gone; the Template item says how many tables differ.
- Phone width: ☰, search, workbook selector and a ⋯ menu (load, what changed, changes, export, Dataverse,
  template, help, save state). The header no longer scrolls sideways.

Navigation and keyboard
- A single sidebar group (e.g. a converted export with no areas) starts expanded.
- Table pages show the eight most common field types with "+N more".
- Grid rows can be reached with Tab; Enter opens the details, Enter or F2 on a value edits it, Esc cancels.
- Side panels are labelled for screen readers; visible focus outline throughout.

Tests
- New tests/ui.js (21 checks); `npm test` runs all four test files.

# 1.2.2

- Workbook selector in the header (in place of the Files button): shows which workbook is open and lists every
  workbook kept in this browser, plus the empty template, "Open another workbook…" and "Manage files…".
  Switching opens that workbook with its own edits, without comparing two unrelated workbooks.
- When the page reopens a workbook from last time, the Overview says so, with Switch workbook / Open another.
- The "no workbook open" page lists the workbooks kept in this browser, each with an Open button.
- The Files panel explains that these workbooks are kept by the browser and are not part of the HTML file (anyone
  you share it with starts with only the empty template), and adds **Remove all…** to start clean.

# 1.2.1

- The built-in starter template is no longer checked or summarised. With no workbook open, the Overview says so and
  offers **Open workbook…** (the header button reads the same), so its example table (Need) can't be mistaken for
  part of your model.
- Lookups to a table with no tab: one finding per missing table (with the number of fields and tables pointing at
  it), instead of one per field. A warning only when the table has one of your own prefixes (from the custom tables
  in the workbook, Microsoft's ms…/adx left out); otherwise info. On a full 230-table export: 5,412 findings → 1,304
  info.
- Dictionary entries that share a name (two "Email" tables, two "Session" tables) now link to their own tabs instead
  of both to the first, which wrongly reported the others as missing from the dictionary.
- "Logical name format" and "Custom field without a publisher prefix" are info: in real exports they only flag
  Microsoft's own fields.

# 1.2.0

Overview (the page now opens here)
- Tables (custom and standard), fields, lookups, related table pairs, unresolved lookups, errors, warnings, your
  edits and changes since the previous version. Tiles open the matching detail.
- Documentation completeness: fields and tables with a description, dictionary entries with an area and a purpose,
  and the least-described tables.
- By area: tables, fields, % described and issues per area.
- Checks summary, latest changes and edits, and the Dataverse check status.

Checks (new page, and a count in the sidebar)
- Errors: table or field without a logical name, duplicate field, the same table on two tabs.
- Warnings: logical-name format, no attribute type, custom field without a publisher prefix, lookup without targets,
  lookup to a table with no tab (user, team and similar system tables excluded), dictionary entry with no tab,
  tab missing from the dictionary.
- Info: primary key field not listed.
- Filter by severity, check or text; click a finding to open its row; export as CSV. Updates as you edit.

Dataverse check (More ▾ → Dataverse check, or from the Overview)
- Builds Web API links for the workbook's tables from the environment URL; open them while signed in, save the
  JSON, and load or drop the files. Batch and single-table responses are both accepted; Dataverse error responses
  are reported with their message. Nothing leaves the browser.
- Compares: tables and fields that don't exist, custom Dataverse fields that aren't documented, attribute types,
  required levels (Business Required = ApplicationRequired), custom flags, ownership, and lookup Targets against
  N:1 relationships in both directions (owner lookups to user/team understood).
- Table pages show a "From Dataverse" section: primary key and name, every N:1, 1:N and N:N relationship with its
  cascade settings, and alternate keys.
- ERD: optional N:N relationships from Dataverse, drawn as dashed lines; included in the draw.io export.
- Stored in this browser with the workbook and its newer versions; removable from the panel.

Interface
- Header: "How it works", "Template" and "Dataverse check" moved into More ▾ so Changes and Export always fit; the
  save label is a compact "● Saved"; the file name stays on one line.
- Moving to Overview, Checks, ERD or Help closes any open side panel; only one side panel is open at a time.

Tests
- New tests/checks.js (42 checks). `npm test` runs smoke, round-trip and checks.

# 1.1.0

Data safety
- Save back to the original / Download an updated copy: refused if any edit cannot be written. The dialog names each
  table, row and column. The output is read back and every edited cell checked; after a save the file on disk is
  checked too. Edits are only cleared after that. "Needs your attention" edits are no longer discarded by a save.
- Sheets whose XML the patcher cannot safely edit (for example namespace-prefixed <x:row>) are refused instead of
  producing a broken file.
- Edits are stored per project (`dme.edits.v3:<project>`), not in one shared list. Loading a new file while edits are
  open asks: newer version (carry edits over) or different workbook. Opening a file from Files brings back its own
  edits. 1.0 edits are migrated once.
- A "Saved in this browser" / "Not saved" label in the header; storage failures for edits, workbooks and custom
  templates are reported instead of ignored.

Comparison
- "What changed" and its CSV now cover columns added/removed, table details (ownership, description, audit…) and
  the notes above plain tables, Forms/Views added/removed, and lookup relationships gained or lost.
- Converting a metadata export no longer leads to a comparison against the previously open file after a reload.

Export
- "Current view as CSV" exports the visible columns only; "…all columns" includes hidden ones.
- CSV values starting with = + - @ are written as text (formula-injection guard).
- Template export no longer fails on a custom template whose header is on row 1.

Fixes
- Esc while editing in the row panel cancels the edit without closing the panel.
- Search highlighting no longer garbles text containing &, < or ".
- A file name is escaped in the sidebar tooltip; build.py writes the bundled file name as a safe JS string, guards
  SheetJS against "</script" and fills data placeholders before inserting libraries.
- Hidden-column choices are keyed by sheet name rather than position.
- Small screens: a ☰ button opens the table list.
- Help text updated (storage, carry-over, save checks, CSV); wording of the save error fixed.
- Removed dead code; the ERD resize observer is disconnected when the ERD is redrawn.

Build and tests
- SheetJS 0.20.3 from cdn.sheetjs.com (npm's 0.18.5 has CVE-2023-30533 and CVE-2024-22363).
- Playwright pinned; `npm test` builds first and runs tests/smoke.js and the new tests/roundtrip.js.
