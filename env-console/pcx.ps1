# Runs pcx from this folder without needing `npm link`:  .\pcx env list
$cli = Join-Path $PSScriptRoot 'dist/src/cli/index.js'
if (-not (Test-Path $cli)) { Write-Host 'Not built yet. Run: npm install; npm run build   (or run setup.ps1)' -ForegroundColor Red; exit 1 }
& node $cli @args
exit $LASTEXITCODE
