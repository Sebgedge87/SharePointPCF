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
