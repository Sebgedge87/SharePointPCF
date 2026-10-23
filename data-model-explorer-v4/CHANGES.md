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

**Read-only copies**
- **Save & share → Download the workbook (.xlsx)**: the workbook the copy was made from, edits written in, formatting
  kept.

**Other**
- An empty page opens on **Start here**: Open workbook…, Download blank template, and inside an environment This
  environment….
- Disabled buttons look disabled.
- Tests: 327. Guide updated, with a new section "The header" and new screenshots.
- `FORMUS_DataModelExplorer_4_0_0_0.zip`: the web resource solution for 4.0.
