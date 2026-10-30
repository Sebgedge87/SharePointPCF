<#
.SYNOPSIS
  Sets up Env Console (pcx) from start to finish, and updates it when run again.

.DESCRIPTION
  1. Installs Node.js, PowerShell 7 and git if they are missing (winget on Windows).
  2. Installs the Az.Accounts module used for sign-in.
  3. Downloads the code (or updates it), builds it and adds the pcx command.
  4. Asks for your environment URLs (or takes them as parameters).
  5. Signs you in.
  6. Opens the dashboard.

  Safe to run again: anything already done is skipped.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\setup.ps1

.EXAMPLE
  .\setup.ps1 -Dev https://contoso-dev.crm11.dynamics.com -Uat https://contoso-uat.crm11.dynamics.com -Prod https://contoso.crm11.dynamics.com -TenantId contoso.onmicrosoft.com
#>
[CmdletBinding()]
param(
    [string]$Dev,
    [string]$Test,
    [string]$Uat,
    [string]$PreProd,
    [string]$Prod,
    # Tenant ID or domain. Only needed if your account can sign in to more than one tenant.
    [string]$TenantId,
    # Where the code is downloaded when this script is run on its own.
    [string]$InstallPath = (Join-Path $HOME 'pcx'),
    [string]$RepoUrl = 'https://github.com/Sebgedge87/SharePointPCF.git',
    [string]$Branch = 'claude/env-console',
    # Sign in with a code instead of a browser window.
    [switch]$DeviceCode,
    # Finish without starting the dashboard.
    [switch]$NoDashboard,
    # Never prompt; use only the parameters given.
    [switch]$NonInteractive
)

$ErrorActionPreference = 'Stop'
$onWindows = ($PSVersionTable.PSEdition -eq 'Desktop') -or $IsWindows
$total = 6

function Step([int]$n, [string]$text) { Write-Host ''; Write-Host "[$n/$total] $text" -ForegroundColor Cyan }
function Ok([string]$text) { Write-Host "  OK  $text" -ForegroundColor Green }
function Info([string]$text) { Write-Host "      $text" -ForegroundColor Gray }
function Stop-Setup([string]$text) {
    Write-Host ''
    Write-Host "  Setup stopped: $text" -ForegroundColor Red
    exit 1
}
function Has([string]$cmd) { [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }
function Update-SessionPath {
    if ($onWindows) {
        $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
    }
}
function Install-WithWinget([string]$id, [string]$name) {
    if (-not $onWindows) { Stop-Setup "$name is missing. Install it with your package manager, then run this again." }
    if (-not (Has 'winget')) { Stop-Setup "$name is missing and winget is not available. Install $name, then run this again." }
    Info "Installing $name (this can take a few minutes)..."
    winget install --id $id --exact --source winget --silent --accept-package-agreements --accept-source-agreements | Out-Null
    Update-SessionPath
}
function Get-NodeMajor {
    if (-not (Has 'node')) { return 0 }
    $v = (& node --version) -replace '^v', ''
    return [int]($v.Split('.')[0])
}

Write-Host ''
Write-Host 'Env Console setup' -ForegroundColor White

# ------------------------------------------------------------------ 1. tools
Step 1 'Checking tools'

if ((Get-NodeMajor) -lt 20) {
    Install-WithWinget 'OpenJS.NodeJS.LTS' 'Node.js'
    if ((Get-NodeMajor) -lt 20) { Stop-Setup 'Node.js 20 or later is needed. Close this window, open a new one and run this again.' }
}
Ok "Node.js $(& node --version)"

if (-not (Has 'pwsh')) {
    Install-WithWinget 'Microsoft.PowerShell' 'PowerShell 7'
    if (-not (Has 'pwsh')) { Stop-Setup 'PowerShell 7 was installed but is not on PATH yet. Close this window, open a new one and run this again.' }
}
Ok 'PowerShell 7'

# ------------------------------------------------------------------ 2. sign-in module
Step 2 'Checking the Az.Accounts sign-in module'
function Test-AzModule { (& pwsh -NoProfile -NonInteractive -OutputFormat Text -Command "if (Get-Module -ListAvailable -Name Az.Accounts) { 'yes' }") -eq 'yes' }
if (-not (Test-AzModule)) {
    Info 'Installing Az.Accounts for your user...'
    & pwsh -NoProfile -NonInteractive -OutputFormat Text -Command '$ErrorActionPreference = ''Stop''; Install-Module Az.Accounts -Scope CurrentUser -Repository PSGallery -Force -AllowClobber'
    if (-not (Test-AzModule)) { Stop-Setup 'Could not install Az.Accounts. In PowerShell 7 run: Install-Module Az.Accounts -Scope CurrentUser' }
}
Ok 'Az.Accounts'

# ------------------------------------------------------------------ 3. code + build
Step 3 'Getting and building the code'
$appDir = $null
if ($PSScriptRoot -and (Test-Path (Join-Path $PSScriptRoot 'package.json')) -and (Select-String -Path (Join-Path $PSScriptRoot 'package.json') -Pattern '"pcx-env-console"' -Quiet)) {
    $appDir = $PSScriptRoot
    Info "Using the code next to this script: $appDir"
} else {
    if (-not (Has 'git')) {
        Install-WithWinget 'Git.Git' 'git'
        if (-not (Has 'git')) { Stop-Setup 'git was installed but is not on PATH yet. Close this window, open a new one and run this again.' }
    }
    $repoDir = Join-Path $InstallPath 'SharePointPCF'
    if (Test-Path (Join-Path $repoDir '.git')) {
        Info "Updating $repoDir"
        & git -C $repoDir fetch --quiet origin $Branch
        & git -C $repoDir checkout --quiet $Branch
        & git -C $repoDir pull --quiet --ff-only origin $Branch
        if ($LASTEXITCODE -ne 0) { Stop-Setup "Could not update $repoDir. If you changed files there, undo those changes and run this again." }
    } else {
        New-Item -ItemType Directory -Force -Path $InstallPath | Out-Null
        Info "Downloading to $repoDir"
        & git clone --quiet --branch $Branch $RepoUrl $repoDir
        if ($LASTEXITCODE -ne 0) { Stop-Setup 'Could not download the code. If the repository is private, sign in to GitHub in git first (git will prompt), then run this again.' }
    }
    $appDir = Join-Path $repoDir 'env-console'
}

Push-Location $appDir
try {
    Info 'Installing packages...'
    & npm ci --no-audit --no-fund --loglevel=error
    if ($LASTEXITCODE -ne 0) { Stop-Setup 'npm install failed (see the messages above).' }
    Info 'Building...'
    & npm run build --silent
    if ($LASTEXITCODE -ne 0) { Stop-Setup 'The build failed (see the messages above).' }
    & { $ErrorActionPreference = 'Continue'; & npm link --no-audit --no-fund --loglevel=error *> $null }
    if ($LASTEXITCODE -ne 0) { Info 'Could not add the pcx command to PATH; this script still works, and you can run: node dist/src/cli/index.js' }
} finally {
    Pop-Location
}
$script:cli = [System.IO.Path]::GetFullPath((Join-Path $appDir 'dist/src/cli/index.js'))
if (-not (Test-Path -LiteralPath $script:cli)) { Stop-Setup "The build did not produce $($script:cli). Run 'npm run build' in $appDir to see why." }
# Call node.exe itself (not a shim or alias), so the script path always reaches it as the first argument.
$script:nodeExe = (Get-Command node -CommandType Application | Select-Object -First 1).Source
function Pcx {
    # Windows PowerShell 5.1 turns a native program's error output into script errors; keep going and use the exit code instead.
    $ErrorActionPreference = 'Continue'
    $argList = @($script:cli) + @($args)
    & $script:nodeExe @argList
}
Ok 'Built'

# ------------------------------------------------------------------ 4. environments
Step 4 'Environments'
if ($TenantId) {
    Pcx config set tenant $TenantId
    if ($LASTEXITCODE -ne 0) { Stop-Setup "Not a valid tenant: $TenantId" }
}

$configPath = (Pcx config path | Select-Object -Last 1)
$existing = @{}
if (Test-Path $configPath) {
    $cfg = Get-Content -Raw $configPath | ConvertFrom-Json
    foreach ($e in @($cfg.environments)) { if ($e) { $existing[$e.name.ToUpper()] = $e.url } }
}

$wanted = [ordered]@{ DEV = $Dev; TEST = $Test; UAT = $Uat; PREPROD = $PreProd; PROD = $Prod }
$askedAny = $false
foreach ($name in $wanted.Keys) {
    if ($existing.ContainsKey($name)) { Ok "$name  $($existing[$name])"; continue }
    $url = $wanted[$name]
    for ($try = 0; $try -lt 3; $try++) {
        if (-not $url) {
            if ($NonInteractive) { break }
            if (-not $askedAny) {
                Info 'Paste each environment URL from the Power Platform admin center (Environments > your environment > Environment URL).'
                Info 'Press Enter to skip an environment you do not have.'
                $askedAny = $true
            }
            $url = (Read-Host "      $name URL").Trim()
            if (-not $url) { break }
        }
        if ($name -eq 'DEV') { Pcx env add $name $url --unmanaged } else { Pcx env add $name $url }
        if ($LASTEXITCODE -eq 0) { $existing[$name] = $url; break }
        $url = $null
        if ($NonInteractive) { break }
    }
}
if ($existing.Count -eq 0) { Stop-Setup 'No environments were added. Run this again and enter at least one URL.' }

# ------------------------------------------------------------------ 5. sign in
Step 5 'Signing in'
Pcx auth status *> $null
if ($LASTEXITCODE -eq 0) {
    Ok 'Already signed in'
} else {
    Info 'A browser window opens for you to sign in (Connect-AzAccount).'
    if ($DeviceCode) { Pcx auth login --device-code } else { Pcx auth login }
}
Pcx auth status
if ($LASTEXITCODE -ne 0) {
    Info 'Some environments are not reachable yet. The table above says why; the dashboard still opens for the rest.'
}

# ------------------------------------------------------------------ 6. dashboard
Step 6 'Dashboard'
Info 'Next time, start it with:  pcx serve --open'
if ($NoDashboard) { Ok 'Setup finished'; exit 0 }
Info 'Starting. Press Ctrl+C to stop.'
Pcx serve --open
