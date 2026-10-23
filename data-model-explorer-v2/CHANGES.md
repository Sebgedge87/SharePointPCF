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
