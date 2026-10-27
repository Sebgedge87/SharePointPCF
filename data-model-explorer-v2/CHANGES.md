# 2.0.7

- **The version is shown** when you hover the ? button and at the top of How it works, so you can tell which build you are using.
- **Saving when the original file has gone.** If the linked file has been moved, renamed or deleted (or the browser lost its link to it), Save back to the original file offers **Save as…**: choose where to save the updated workbook, and the page links to that file from then on. Your edits are kept until it is saved.
- **A table with no details at all** (the sheet starts at the field list header): a new detail such as Primary Name Column goes in a row inserted above the header, instead of stopping the save.

# 2.0.6

- **Saving no longer stops when a table detail has no row.** Save to the original file / Download an updated copy insert a row just below the last table detail (for example Primary Name Column or Primary Key) and move everything underneath down: cells, merged cells, dropdown lists, conditional formatting, filters, hyperlinks, page breaks, the frozen header and the sheet's own formulas. If an Excel table, a drawing, comments, a named range or another sheet's formula points at the sheet, nothing is saved and the reason is given, as before.
- **Publishers and prefixes** (More ▾): your customisation prefixes (for example cxp, ax, portal) with their publishers, and the prefixes treated as Microsoft's (ms*, adx by default). Used by Checks, new fields and Build solution, which fills in the publisher for the prefix. New check: Prefix not one of yours (info).
- **Build solution never builds a copy of a system field** such as fp_createdon (Dataverse creates createdon on every table). It is listed in the report, and Checks warns: Copy of a system field.
- **Lookups:** changing a field's Attribute Type to Lookup asks which table, then adds `Targets: <table>` to Additional data (and N:1 as the Relationship Type if blank).
- **Sub grid rows** (Attribute Type Sub grid) need no logical name: they are not flagged, counted as fields or built.
- **Back:** a ← button beside the search box, and the browser's Back, Alt+← and a mouse's back button, return to the previous screen.
- Hovering a dropdown, or any text cut short, shows it in full.

# 2.0.5

- **Build a Dataverse solution: Tables only.** A new choice in the dialog, *What to build*: everything (tables, fields and
  relationships, as before) or **Tables only**, which builds each new table with just its primary name column. Fields and
  relationships are left out and listed in build-report.csv; no hand-build list. The choice is remembered per workbook.

# 2.0.4

- **How it works** is laid out as a centred page, with a contents list linking to each section; the five steps sit on one row.
- Tick boxes in side panels are plain tick boxes (no stray border).

# 2.0.3

- User guide for 2.0 in `docs/` (Markdown and Word), with marked screenshots: the eye on each relationship row, the
  read-only copy, the Export menu, and a new section, "Sharing a read-only copy".
- A read-only copy's Overview no longer shows a "your edits" count.

# 2.0.2

- **An eye on each relationship row**, instead of one eye per table with a list. In the ERD's table boxes, every lookup
  row has an eye at its end: click it to hide that relationship, click the crossed-out eye to show it again. A hidden
  row stays in the box, faded, so it can always be brought back.
- N:N relationships now appear as rows in the boxes of both tables (↔ the other table), with their own eye.
- A lookup to a table is shown and hidden from the row in the table that holds the lookup.
- With **Names only** there are no rows, so the table's header has one eye for its own relationships.
- Hidden rows are left out of the draw.io export and the Mermaid source; the eyes are left out of SVG and PNG.

# 2.0.1

- **Show and hide relationships from the diagram itself.** Every table box has an eye in its header. Click it to list
  that table's relationships (its own lookups →, lookups to it ←, N:N ↔), each with an eye to show or hide it, plus
  **Show all** and **Hide all**. The list stays open while you click, and Escape or a click elsewhere closes it.
- A table with hidden relationships shows a crossed-out eye and how many are hidden. A table whose relationships are
  all hidden stays on the diagram, so it can be brought back.
- The relationship buttons in the side list are gone; the side panel still says how many are hidden, with **show all**.
- The eyes are left out of SVG and PNG exports.

# 2.0.0

Built on 1.9.3 (see [../data-model-explorer/CHANGES.md](../data-model-explorer/CHANGES.md) for earlier versions).

**ERD**
- The diagram is drawn by the page from the model, as SVG, instead of by the Mermaid library. 1.9.3 already laid the
  tables out and routed the lines itself, after Mermaid had spent most of the time on a layout that was then thrown
  away. 300 tables draw in about 2.5 s instead of 78 s.
- The Mermaid library is no longer bundled, so the file is 2.2 MB instead of 5.7 MB. Copy Mermaid and .mmd still give
  the Mermaid source.
- Layout: the step that reduces crossing lines now works out only what a move changes, so it does far more in the same
  time and also runs on diagrams with more than 700 lines (it was skipped there).
- **Direction** now shapes the layout: left to right turns a layout that comes out tall on its side; top to bottom
  does the opposite. (In 1.9.3 the page's own layout ignored it.)
- Dragging a table re-draws only its own lines, once per frame. Hovering changes only the hovered table's lines and
  dims the rest with one style.
- Line ends use crow's-foot notation in the SVG itself, so SVG exports show them in any viewer.

**Read-only copies**
- **Export → Read-only copy (.html)…** saves a copy of the page holding the open workbook, with your edits written in.
  It opens straight onto that workbook and can be browsed, searched, checked, diagrammed and exported as CSV or plain
  values, but not edited, saved, built into a solution, or used to open other workbooks. It keeps nothing in the
  browser.
- `build.py --readonly --workbook <file>` makes one from the command line.

**Other**
- All fields search keeps each row's searchable text between keystrokes instead of rebuilding it for every search.
- Tests: `tests/erd.js` (drawing, line ends, hover, drag, exports, Direction, a 300-table draw under 12 s) and
  `tests/readonly.js` (making a copy and everything it refuses). 281 tests in all.
