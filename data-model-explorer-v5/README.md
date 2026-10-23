# Data Model Explorer 5.0

Version 4.0, plus an **XrmToolBox tool**. Kept in its own folder: 1.9.3 (`../data-model-explorer`), 2.0
(`../data-model-explorer-v2`), 3.0 (`../data-model-explorer-live`) and 4.0 (`../data-model-explorer-v4`) are unchanged.

The page (`Data_Model_Explorer.html`) is the same as 4.0 and can still be opened as a file or uploaded to an environment
as a web resource (`FORMUS_DataModelExplorer_5_0_0_0.zip`; see the 4.0 README). The guide is
[`docs/User_Guide.md`](docs/User_Guide.md) (also `docs/User_Guide.docx`).

## The XrmToolBox tool

`xrmtoolbox/` is a .NET Framework 4.8 class library that XrmToolBox loads as a tool. It shows the page in WebView2 at
the connected environment's address, so the page runs in its "inside Dynamics 365" mode with no changes:

- the page itself comes from the dll (it is embedded when the tool is built), not from the environment;
- the page's Web API requests (`/api/data/...`) are sent on with XrmToolBox's access token for the connection, so it reads
  the environment as the connected user;
- only read requests are passed on: the tool cannot change the environment.

### Try it without building

`xrmtoolbox/release/FormusPro.DataModelExplorer.XrmToolBox.dll` is the tool, ready built (5.0.0, for XrmToolBox
1.2025.10 or later).

1. Download it, right-click it → **Properties** → tick **Unblock** → OK. (Windows marks downloaded files, and XrmToolBox
   won't load a marked dll. Or in PowerShell: `Unblock-File .\FormusPro.DataModelExplorer.XrmToolBox.dll`.)
2. Close XrmToolBox and copy the dll into `%APPDATA%\MscrmTools\XrmToolBox\Plugins` (for a portable XrmToolBox, its
   own `Plugins` folder).
3. Start XrmToolBox, connect, and open **Data Model Explorer** from the tool list.

### Build and try it (Windows, .NET SDK 8 or later)

```
npm install
npm run build
copy dist\Data_Model_Explorer.html .
cd xrmtoolbox
.\deploy.ps1          # builds, then copies the dll into %APPDATA%\MscrmTools\XrmToolBox\Plugins (close XrmToolBox first)
```

Then start XrmToolBox, connect, and open **Data Model Explorer** from the tool list.

### Publish it to the Tool Library

Fill in `projectUrl` and `iconUrl` in `xrmtoolbox/DataModelExplorer.XrmToolBox.nuspec`, then
`dotnet build -c Release`, `nuget pack DataModelExplorer.XrmToolBox.nuspec` and push the package to nuget.org. XrmToolBox
lists packages tagged `XrmToolBox` that depend on the `XrmToolBox` package.

### Notes

- Needs the Microsoft Edge WebView2 Runtime (part of Windows 10 and 11).
- Needs a connection that gives an access token: Microsoft 365 sign-in (OAuth), client secret or certificate.
- The tool compiles against XrmToolBox 1.2025.10.74. It has not yet been run inside XrmToolBox: try it on a development
  environment first.
- `make-icons.py` redraws the tool's icons into `Icons.cs`.

## For developers

```
npm test               # 335 browser tests for the page
npm run webresource    # the web resource solution zip
```
