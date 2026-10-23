# 5.0.1

- **How it works** is laid out as a centred page, with a contents list linking to each section; the five steps sit on one row.
- Tick boxes in side panels are plain tick boxes (no stray border).
- **This environment:** the solution lists are searchable. Your unmanaged solutions come first; managed ones are folded under a
  count and open when you search or click them. Load is greyed out until a solution is picked, then names it.
- **How it works** uses the 4.0 button names (Workbook ▾, Check ▾, Save & share, Build solution) and describes the new ERD panel.
- The XrmToolBox tool is rebuilt with this page (`xrmtoolbox/release`, 5.0.1).

# 5.0.0

Built on 4.0.0 (see [../data-model-explorer-v4/CHANGES.md](../data-model-explorer-v4/CHANGES.md) for earlier versions).
The page is the same as 4.0.

**XrmToolBox tool** (`xrmtoolbox/`)
- Opens the page in WebView2 inside XrmToolBox, on the environment XrmToolBox is connected to, so it runs as it does
  inside Dynamics 365: load a solution as the model, check a workbook against the environment, managed-environment check.
- The page is built into the dll. Its Web API requests are sent on with XrmToolBox's access token (refreshed as
  needed); only read (GET) requests are passed on.
- Changing the connection reopens the page on the new environment. Workbooks, edits and ERD layouts are kept in a
  browser profile in XrmToolBox's settings folder.
- Built against XrmToolBox 1.2025.10.74 (with MscrmTools.Xrm.Connection 1.2025.9.64 and WebView2 1.0.3351.48, the
  versions XrmToolBox ships). `deploy.ps1` builds and installs it; `DataModelExplorer.XrmToolBox.nuspec` packs it for
  the Tool Library.
- Checked by compiling against those libraries; not yet run inside XrmToolBox.

**Other**
- User guide: new section "Using it in XrmToolBox".
- `FORMUS_DataModelExplorer_5_0_0_0.zip`: the web resource solution, as in 4.0.
