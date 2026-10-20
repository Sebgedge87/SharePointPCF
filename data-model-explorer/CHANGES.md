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
