# Data Model Explorer 2.0

A new version of the [Data Model Explorer](../data-model-explorer), kept in its own folder so the working 1.9.3 is
untouched. It does everything 1.9.3 does, plus:

- **A much faster ERD.** The diagram is drawn by the page itself instead of by the Mermaid library. 300 tables and
  900 relationships draw in about 2.5 seconds instead of 78. Dragging and hovering stay quick on big diagrams.
- **Read-only copies** to give to a client or a support team (see below).
- **A smaller file.** 2.2 MB instead of 5.7 MB, so it opens faster.

Download **`Data_Model_Explorer.html`** from this folder and double-click it to open it in Chrome or Edge. The
[1.9.3 user guide](../data-model-explorer/docs/User_Guide.md) applies; the differences are listed in
[CHANGES.md](CHANGES.md).

## Read-only copies

**From the page:** open the workbook, then **Export ▾ → Read-only copy (.html)…**. You get one HTML file,
`<workbook> (read-only).html`, holding that workbook with your current edits written in. Send it like any file.

The person who opens it can:

- browse, search and filter every table and field, and use All fields
- read the Overview and Checks
- draw the ERD, hide relationships, and export the diagram (draw.io, SVG, PNG, Mermaid)
- run the Dataverse check against their environment
- export the current view as CSV, or the workbook as plain values

They can't edit values, add fields, change keys or table details, change the template, save the workbook, build a
solution, or open a different workbook. The header says **Read-only**. The page refuses changes in its code, not just
by hiding buttons, and keeps nothing in their browser.

**From the command line:**

```
python3 build.py --readonly --workbook "Client Model v1.3.xlsx" --out "Client Model (read-only).html"
```

Like any build with `--workbook`, the result contains the client's data: never commit it.

## Speed: 1.9.3 and 2.0 compared

Measured on a generated model of 300 tables and 12,000 fields (`tools/app-timings.js`, `tools/erd-timings.js`):

| ERD | 1.9.3 | 2.0 |
| --- | --- | --- |
| Draw 30 tables (111 boxes with the tables they look up) | 3.5 s | 0.9 s |
| Draw 100 tables (213 boxes) | 8.4 s | 1.5 s |
| Draw 200 tables (285 boxes) | 19.6 s | 2.1 s |
| Draw 300 tables, 900 relationships | 78.0 s | 2.5 s |
| Drag a table on the 300-table diagram (20 moves) | 3.5 s | 0.9 s |
| Hover 10 tables on the 300-table diagram | 1.7 s | 0.5 s |

| Rest of the page | 1.9.3 | 2.0 |
| --- | --- | --- |
| File size | 5.7 MB | 2.2 MB |
| Open the page | 0.8 s | 0.5 s |
| Search All fields (12,000 rows), per search | 0.09–0.14 s | 0.03–0.11 s |

Opening a workbook, table pages, Checks, Overview and editing were already under 0.2 s on this model and are
unchanged. An 800-table, 40,000-field workbook (26 MB) opens in about 4 to 5 s; that time is the spreadsheet library
reading the file.

## For developers

Same layout as 1.9.3: the page is `src/index.template.html`, and `build.py` inlines the libraries, logo and template.

```
npm install
npm run build        # dist/Data_Model_Explorer.html
npm test             # 281 browser tests, including tests/erd.js and tests/readonly.js
```

Mermaid is no longer a dependency. **Copy Mermaid** and **.mmd** still give the Mermaid source of the diagram, which is
generated as text.
