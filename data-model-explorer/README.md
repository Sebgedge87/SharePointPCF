# Data Model Explorer

Offline, single-file viewer and editor for Dataverse data-model workbooks (Table Dictionary plus one tab per table).
Opens on an overview (size, documentation completeness, latest changes), runs data-model checks, compares the model with a Dataverse environment's metadata, and lets you view, filter, edit, compare versions, convert Metadata Document Generator exports, draw an ERD, export to Excel, Mermaid, SVG, PNG or draw.io.

## Just want to use it?

Download **`Data_Model_Explorer.html`** from this folder and double-click it to open it in Chrome or Edge.
Nothing to install, and it works offline. Everything below is only for changing the code.

The ready-built file opens on the empty template; load your own workbook with **Load updated version…** or by
dragging it onto the page. Nothing is uploaded anywhere. After changing the code, rebuild and replace this file
(`npm run build`, then copy `dist/Data_Model_Explorer.html` here). Never commit a build made with `--workbook`, because it contains that workbook.

## Build

```
npm install
npm run build                       # dist/Data_Model_Explorer.html, bundling the slim template
python3 build.py --workbook client.xlsx   # optional: open on a client workbook (keep it out of git)
```

SheetJS is installed from `cdn.sheetjs.com` (0.20.3). The npm registry only has 0.18.5, which has known security issues
(CVE-2023-30533, CVE-2024-22363), and this tool parses client files.

## Test

```
npm test        # builds first, then runs both tests. Needs Playwright + Chromium (CHROMIUM=/path if needed)
```

## Layout

| Path | What |
|---|---|
| `src/index.template.html` | The whole app (HTML, CSS, JS) with `__PLACEHOLDERS__` for inlined libraries and data |
| `assets/` | Logo and the slim template workbook that Export formats against |
| `build.py` | Inlines SheetJS, ExcelJS, JSZip, Mermaid, the logo, the template and a starting workbook |
| `tests/smoke.js` | Load, convert, ERD, draw.io export, persistence |
| `tests/checks.js` | Overview, every data-model check, Dataverse import (both JSON shapes, error files), Dataverse comparison, relationships on table pages, N:N in the ERD and draw.io |
| `tests/roundtrip.js` | Edit, export both ways and read back, reload, carry edits to a newer version, keep workbooks separate, structural comparison, refused partial save, CSV columns, small screens |

## Notes

- Everything runs in the browser; nothing is uploaded. Open workbooks are kept in IndexedDB; edits, column choices and ERD layouts in localStorage, for the browser profile.
- Edits are stored per project: one workbook plus the newer versions you choose to carry edits forward to (`dme.edits.v3:<project>`). Loading a new file while edits are open asks whether it is a newer version or a different workbook. Edits saved by 1.0 (`dme.edits.v2`) are moved to the workbook that was open, on first start.
- Saving back to the original, or downloading an updated copy, is refused if any edit cannot be written; the file is read back and every edited cell checked before edits are cleared.
- Checks (`issues()` in the template) are recomputed whenever a value changes. Rules and severities are in `RULES`.
- Dataverse comparison stays offline: the Dataverse panel builds Web API links (`EntityDefinitions` with Attributes, N:1, 1:N and N:N relationships and Keys) for the workbook's tables, 20 per link, plus one link per table as a fallback. The person opens them while signed in, saves the JSON and loads it. Imported metadata is stored in IndexedDB per project (`__dv:<project>`).
- Write-back to the original file and linking use the File System Access API (Chrome or Edge).
- Do not commit client workbooks: `.gitignore` excludes `*.xlsx` except the template.
