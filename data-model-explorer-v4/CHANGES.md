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
