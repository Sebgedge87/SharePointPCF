# Build the tool and copy it into XrmToolBox's Plugins folder, to try it out.
#   .\deploy.ps1                 (XrmToolBox must be closed, or it keeps the old dll)
#   .\deploy.ps1 -Plugins D:\XrmToolBox\Plugins   (for a portable XrmToolBox)
param([string]$Plugins = (Join-Path $env:APPDATA 'MscrmTools\XrmToolBox\Plugins'))
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
if (-not (Test-Path ..\Data_Model_Explorer.html)) { throw 'Data_Model_Explorer.html is missing in the folder above: run npm run build there and copy dist\Data_Model_Explorer.html up.' }
dotnet build -c Release
New-Item -ItemType Directory -Force $Plugins | Out-Null
Copy-Item bin\Release\net48\FormusPro.DataModelExplorer.XrmToolBox.dll $Plugins -Force
Write-Host "Copied to $Plugins. Start XrmToolBox and open Data Model Explorer from the tool list."
