# Data Model Explorer

Offline, single-file tool for Dataverse data models kept as Excel workbooks (a Table Dictionary plus one tab per table).
It reviews the model and builds it: open a workbook, check it, compare versions, draw the ERD, and generate a Dataverse
solution that creates the tables, fields and relationships for you.

## Just want to use it?

Download **`Data_Model_Explorer.html`** from this folder and double-click it to open it in Chrome or Edge.
Nothing to install, and it works offline. Nothing is uploaded anywhere.

1. **Open your workbook** with **Open workbook…** or by dragging it onto the page. A Metadata Document Generator export
   is converted automatically, and keeps its own file name.
2. **Overview** shows the size of the model, how complete the documentation is, and the latest changes.
3. **Checks** lists problems in the model: missing or duplicated names, lookups to undocumented tables, missing primary
   name columns, relationship types to review. They update as you edit.
4. **Tables** can be searched, filtered (also by area) and edited; edits are kept in your browser and can be written
   back to the workbook or exported. **＋ Add field** adds a field, lookup or N:N relationship to a table (names are
   suggested with your prefix); **＋ Add row** adds a row to other sheets such as the Table Dictionary. Columns the
   template has but your workbook lacks, such as Relationship Type, are added so you can fill them in.
   **Set as primary key** / **Set as primary name** on a field, or **✎ Table details**, record a table's keys and other
   details. Downloads of the workbook ask for a file name first.
5. **ERD** draws the tables you pick, by area if the Table Dictionary has areas, and exports to draw.io, SVG, PNG or
   Mermaid. Lines only show relationship ends (one / many) when the relationship type is recorded.
6. **Load version…** compares a newer version of the workbook with the one open, and carries your edits over.

The browser remembers the workbooks you open; the selector in the header switches between them. They are kept in your
browser only, not in the HTML file, so anyone you share the file with starts with just the empty template.
**Manage files… → Remove all…** clears them.

### Building the model in Dataverse

**Export → Dataverse solution (.zip)…** turns the workbook into an unmanaged solution, so nothing has to be created by
hand in Power Apps.

1. Set the solution name, version and publisher in the dialog. The prefix and choice value prefix are suggested from the
   workbook; if the environment already has your publisher, use its exact unique name. The dialog shows what will be
   built and what won't.
2. **Generate** downloads one zip. Unzip it and run, in PowerShell:

   ```powershell
   .\import.ps1 -EnvironmentUrl https://yourorg.crm11.dynamics.com          # add -Check to run the solution checker first
   ```

   The script installs the Power Platform CLI (pac) if it is missing, opens a browser window to sign in, and imports
   the solution. Your account needs the System Customizer or System Administrator role. **Import into a development
   environment first.**
3. Read **build-report.csv**: everything included, left out (and why), or to build by hand.
4. Create the fields in **calculated-and-rollup-fields.xlsx** by hand. Their formulas aren't in the workbook.
5. Lay out forms and views in Power Apps, then export the solution as managed for test and production.

What is built: every new table with your prefix (with its primary name column, primary key, ownership, notes and
activities settings) and its fields; your new fields on existing tables such as Contact, included without changing
anything else about them; a relationship for every lookup and customer lookup; and every N:N relationship.
Field settings carry over: text length and format, number ranges and precision, currency precision, date format,
Yes/No labels, choice options with their values, defaults, required level and field security.

Not built (listed in the report instead): calculated and rollup fields, activity tables, lookups to several tables,
image and file fields, and choice fields with no options.

What the workbook needs, in the template from this folder:

| Where | Row or column | What to put |
|---|---|---|
| Table details | **Primary Name Column**, **Primary Key** | The table's name field and key (filled in automatically from a Metadata Document Generator export) |
| Table details | **Is Activity**, **Has Notes**, **Has Activities** | True / False |
| Field list | **Relationship Type** | `N:1` on a lookup; `N:N` on a row that describes a many-to-many relationship, with the other table in Additional data as `Targets: other_table` |
| Field list | **Relationship Name** | Optional; generated if blank |
| Field list | **Cascade Delete** | Remove Link (default), Restrict or Cascade |

The generated files are checked with Microsoft's own packaging tool (`pac solution unpack` / `pack`), so they are valid
solution files. A first import into a development environment is still the real test: if Dataverse rejects anything,
the message from `import.ps1` says what.

### Changing the code

After changing the code, rebuild and replace this file (`npm run build`, then copy `dist/Data_Model_Explorer.html`
here). Never commit a build made with `--workbook`, because it contains that workbook.

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
npm test        # builds first, then runs all six test files. Needs Playwright + Chromium (CHROMIUM=/path if needed)
PAC=/path/to/pac npm test   # also checks the generated solution with Microsoft's SolutionPackager
```

## Layout

| Path | What |
|---|---|
| `src/index.template.html` | The whole app (HTML, CSS, JS) with `__PLACEHOLDERS__` for inlined libraries and data |
| `assets/` | Logo and the slim template workbook that Export formats against |
| `build.py` | Inlines SheetJS, ExcelJS, JSZip, Mermaid, the logo, the template and a starting workbook |
| `tests/smoke.js` | Load, convert, ERD, draw.io export, persistence |
| `tests/checks.js` | Overview, every data-model check, Dataverse import (both JSON shapes, error files), Dataverse comparison, relationships on table pages, N:N in the ERD and draw.io |
| `tests/ui.js` | Interface: area filters (ERD, Checks, All fields) and live Area edits, ERD defaults on a 90-table model, header and menus, keyboard access, field-type trimming, severity colours, phone layout |
| `tests/solution.js` | Solution generator: dialog, every field type, relationships, shells for existing tables, the build report, import.ps1; with `PAC=/path/to/pac` also unpacks and re-packs the solution with Microsoft's SolutionPackager |
| `tests/addrows.js` | Primary key markers, setting the key and name, the Table details dialog and writing details back; naming downloads; adding fields, lookups, N:N and dictionary rows; saving them into the original and the template export; refusing when there's no room; reload, carry to a newer version, removing; columns added from the template and written on save |
| `tests/roundtrip.js` | Edit, export both ways and read back, reload, carry edits to a newer version, keep workbooks separate, structural comparison, refused partial save, CSV columns, small screens |

## Notes

- Everything runs in the browser; nothing is uploaded. Open workbooks are kept in IndexedDB; edits, column choices and ERD layouts in localStorage, for the browser profile.
- Edits are stored per project: one workbook plus the newer versions you choose to carry edits forward to (`dme.edits.v3:<project>`). Loading a new file while edits are open asks whether it is a newer version or a different workbook. Edits saved by 1.0 (`dme.edits.v2`) are moved to the workbook that was open, on first start.
- Rows added in the page are stored with the edits (one record per row) and carried to newer versions. Saving back puts them in the empty rows after the field list, never inserting rows; it is refused if there is no room. Columns from the template that a sheet lacks are appended to the sheet (`tmplAdded`), and their header and hint are written with the first value saved in them.
- Saving back to the original, or downloading an updated copy, is refused if any edit cannot be written; the file is read back and every edited cell checked before edits are cleared.
- Adding to the template: any column added to the field header row (on the row that starts `Logical Name`, `Schema Name`) is read, shown, filterable, editable and exported; text in the row just above the header becomes the column's hint. Any label/value row above that hint row is read as a table detail. A column whose values are a short repeated set edits as a dropdown; a data-validation list in the template sets its options. Special display, checks or build behaviour for a new column needs a code change keyed on its header name.
- Checks (`issues()` in the template) are recomputed whenever a value changes. Rules and severities are in `RULES`.
- Dataverse comparison stays offline: the Dataverse panel builds Web API links (`EntityDefinitions` with Attributes, N:1, 1:N and N:N relationships and Keys) for the workbook's tables, 20 per link, plus one link per table as a fallback. The person opens them while signed in, saves the JSON and loads it. Imported metadata is stored in IndexedDB per project (`__dv:<project>`).
- **Building a Dataverse solution** (Export → Dataverse solution): generates an unmanaged solution (`solution.xml`, `customizations.xml`) from the workbook in the browser, with `import.ps1` (installs pac if missing, signs in, `pac solution import`), `build-report.csv` and the hand-build list. Tables and fields with the chosen prefix are built; existing tables are included as shells holding only the new fields. The template's table details include Primary Name Column, Primary Key, Is Activity, Has Notes and Has Activities; its field list includes Relationship Type (N:1 / N:N), Relationship Name and Cascade Delete.
- The generated XML is checked by the tests with Microsoft's SolutionPackager (`pac solution unpack` / `pack`). That proves the files are well-formed solution files, not that an import will succeed: import into a development environment first, and compare it with a solution exported from that environment if anything is rejected.
- Write-back to the original file and linking use the File System Access API (Chrome or Edge).
- Do not commit client workbooks: `.gitignore` excludes `*.xlsx` except the template.
