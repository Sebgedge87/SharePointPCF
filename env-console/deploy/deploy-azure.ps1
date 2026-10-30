<#
.SYNOPSIS
  Hosts Env Console on Azure App Service, where everyone signs in with their own Microsoft account.

.DESCRIPTION
  1. Checks you are signed in to the Azure CLI.
  2. Builds the app and packages it.
  3. Creates (or reuses) an Entra app registration:
     - redirect URI https://<AppName>.azurewebsites.net/auth/callback
     - delegated permission "Dynamics CRM: user_impersonation" (act as the signed-in user)
     - admin consent (needs a Global, Application or Cloud Application Administrator)
     - "Assignment required", so only the group you name (or just you) can sign in
     - a client secret, stored only in the web app's settings
  4. Creates (or reuses) a resource group, a Linux App Service plan and the web app (Node 22, HTTPS only).
  5. Sets the app settings and deploys the code.

  Safe to run again: existing resources are reused and the code is redeployed.
  Environments come from -Dev/-Test/-Uat/-PreProd/-Prod, or from your local pcx config.

.EXAMPLE
  .\deploy-azure.ps1 -AppName pcx-contoso -AllowedGroup "Power Platform Admins"

.EXAMPLE
  .\deploy-azure.ps1 -AppName pcx-contoso -Location westeurope -Dev https://contoso-dev.crm4.dynamics.com -Prod https://contoso.crm4.dynamics.com
#>
#Requires -Version 7.0
[CmdletBinding()]
param(
    # Becomes https://<AppName>.azurewebsites.net. Letters, digits and hyphens; must be unique in Azure.
    [Parameter(Mandatory = $true)][ValidatePattern('^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$')][string]$AppName,
    [string]$ResourceGroup,
    [string]$Location = 'uksouth',
    [string]$Sku = 'B1',
    # Entra group (display name or object ID) whose members may sign in. Without it, only you are allowed.
    [string]$AllowedGroup,
    [string]$Dev,
    [string]$Test,
    [string]$Uat,
    [string]$PreProd,
    [string]$Prod,
    # Create a new client secret even if the app already has one.
    [switch]$RotateSecret
)

$ErrorActionPreference = 'Stop'
if (-not $ResourceGroup) { $ResourceGroup = "rg-$AppName" }
$appDir = Split-Path -Parent $PSScriptRoot
$publicUrl = "https://$AppName.azurewebsites.net"
$displayName = "Env Console ($AppName)"
$dynamicsApi = '00000007-0000-0000-c000-000000000000'      # Dynamics CRM (Dataverse)
$userImpersonation = '78ce3f0f-a1ce-49c2-8cde-64b5c0896db4' # its delegated user_impersonation scope
$total = 6

function Step([int]$n, [string]$text) { Write-Host ''; Write-Host "[$n/$total] $text" -ForegroundColor Cyan }
function Ok([string]$text) { Write-Host "  OK  $text" -ForegroundColor Green }
function Info([string]$text) { Write-Host "      $text" -ForegroundColor Gray }
function Warn([string]$text) { Write-Host "  !!  $text" -ForegroundColor Yellow }
function Stop-Deploy([string]$text) { Write-Host ''; Write-Host "  Deploy stopped: $text" -ForegroundColor Red; exit 1 }

# Runs az and returns trimmed text output; stops on failure unless -AllowFail.
function Az {
    param([Parameter(ValueFromRemainingArguments = $true)][string[]]$AzArgs)
    $allowFail = $false
    if ($AzArgs -and $AzArgs[0] -eq '-AllowFail') { $allowFail = $true; $AzArgs = $AzArgs[1..($AzArgs.Length - 1)] }
    $out = & az @AzArgs 2>&1
    if ($LASTEXITCODE -ne 0) {
        if ($allowFail) { return $null }
        Stop-Deploy ("az " + ($AzArgs -join ' ') + "`n" + ($out | Out-String))
    }
    return (($out | Where-Object { $_ -isnot [System.Management.Automation.ErrorRecord] }) -join "`n").Trim()
}

function Write-JsonFile($value) {
    $path = [System.IO.Path]::GetTempFileName()
    $value | ConvertTo-Json -Depth 5 -Compress | Set-Content -Path $path -Encoding utf8
    return $path
}

# ------------------------------------------------------------------ 1. azure sign-in
Step 1 'Checking Azure sign-in'
if (-not (Get-Command az -ErrorAction SilentlyContinue)) { Stop-Deploy 'The Azure CLI (az) is not installed. On Windows: winget install Microsoft.AzureCLI' }
$account = Az -AllowFail account show --query "{tenant:tenantId, user:user.name, sub:name}" -o json
if (-not $account) {
    & az login | Out-Null
    $account = Az account show --query "{tenant:tenantId, user:user.name, sub:name}" -o json
}
$acct = $account | ConvertFrom-Json
$tenantId = $acct.tenant
Ok "Signed in as $($acct.user), subscription '$($acct.sub)', tenant $tenantId"

# ------------------------------------------------------------------ environments
$envs = @()
$given = [ordered]@{ DEV = $Dev; TEST = $Test; UAT = $Uat; PREPROD = $PreProd; PROD = $Prod }
foreach ($k in $given.Keys) { if ($given[$k]) { $envs += [pscustomobject]@{ name = $k; url = $given[$k].TrimEnd('/'); managed = ($k -ne 'DEV') } } }
if ($envs.Count -eq 0) {
    $local = if ($env:PCX_CONFIG) { $env:PCX_CONFIG } else { Join-Path $HOME '.pcx/config.json' }
    if (Test-Path $local) {
        $envs = @((Get-Content -Raw $local | ConvertFrom-Json).environments)
        Info "Using environments from $local"
    }
}
if ($envs.Count -eq 0) { Stop-Deploy 'No environments. Pass -Dev/-Test/-Uat/-PreProd/-Prod, or run setup.ps1 first so your local config has them.' }
foreach ($e in $envs) { if ($e.url -notmatch '^https://[a-z0-9-]+(\.[a-z0-9-]+)*\.(dynamics\.com|dynamics\.cn|microsoftdynamics\.us|appsplatform\.us|microsoftdynamics\.de)$') { Stop-Deploy "Not a Dataverse URL: $($e.url)" } }

# ------------------------------------------------------------------ 2. build
Step 2 'Building'
Push-Location $appDir
try {
    & npm ci --no-audit --no-fund --loglevel=error
    if ($LASTEXITCODE -ne 0) { Stop-Deploy 'npm install failed' }
    & npm run build --silent
    if ($LASTEXITCODE -ne 0) { Stop-Deploy 'Build failed' }
} finally { Pop-Location }
$stage = Join-Path ([System.IO.Path]::GetTempPath()) "pcx-deploy-$([guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Path (Join-Path $stage 'dist') | Out-Null
Copy-Item -Recurse (Join-Path $appDir 'dist/src') (Join-Path $stage 'dist/src')
Copy-Item -Recurse (Join-Path $appDir 'public') (Join-Path $stage 'public')
Copy-Item -Recurse (Join-Path $appDir 'docs') (Join-Path $stage 'docs')
Copy-Item (Join-Path $appDir 'package.json') $stage
$zip = "$stage.zip"
Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $zip -Force
Ok 'Packaged (no runtime dependencies)'

# ------------------------------------------------------------------ 3. app registration
Step 3 'Entra app registration'
$appId = Az ad app list --display-name $displayName --query "[0].appId" -o tsv
if (-not $appId) {
    $appId = Az ad app create --display-name $displayName --sign-in-audience AzureADMyOrg --web-redirect-uris "$publicUrl/auth/callback" --query appId -o tsv
    Ok "Created $displayName ($appId)"
} else {
    Az ad app update --id $appId --web-redirect-uris "$publicUrl/auth/callback" | Out-Null
    Ok "Using $displayName ($appId)"
}
Az -AllowFail ad app permission add --id $appId --api $dynamicsApi --api-permissions "$userImpersonation=Scope" | Out-Null
$spId = Az -AllowFail ad sp show --id $appId --query id -o tsv
if (-not $spId) { $spId = Az ad sp create --id $appId --query id -o tsv }
Az ad sp update --id $appId --set appRoleAssignmentRequired=true | Out-Null
Ok 'Only assigned users and groups can sign in'

$consented = Az -AllowFail ad app permission admin-consent --id $appId
if ($null -eq $consented) {
    Warn 'Could not grant admin consent (you may not be an admin). Ask an admin to open this link and press "Grant admin consent":'
    Info "https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationMenuBlade/~/CallAnAPI/appId/$appId"
} else { Ok 'Admin consent granted for Dynamics CRM user_impersonation' }

$principalId = $null
if ($AllowedGroup) {
    if ($AllowedGroup -match '^[0-9a-f-]{36}$') { $principalId = $AllowedGroup }
    else { $principalId = Az ad group show --group $AllowedGroup --query id -o tsv }
    $who = "group $AllowedGroup"
} else {
    $principalId = Az ad signed-in-user show --query id -o tsv
    $who = 'you'
}
$existing = Az rest --method GET --uri "https://graph.microsoft.com/v1.0/servicePrincipals/$spId/appRoleAssignedTo" --query "value[?principalId=='$principalId'] | length(@)" -o tsv
if ($existing -eq '0') {
    $body = Write-JsonFile @{ principalId = $principalId; resourceId = $spId; appRoleId = '00000000-0000-0000-0000-000000000000' }
    try { Az rest --method POST --uri "https://graph.microsoft.com/v1.0/servicePrincipals/$spId/appRoleAssignedTo" --headers "Content-Type=application/json" --body "@$body" | Out-Null }
    finally { Remove-Item $body -ErrorAction SilentlyContinue }
}
Ok "Sign-in allowed for $who"

# ------------------------------------------------------------------ 4. azure resources
Step 4 'Azure resources'
Az group create --name $ResourceGroup --location $Location -o none
$plan = "plan-$AppName"
if (-not (Az -AllowFail appservice plan show --name $plan --resource-group $ResourceGroup --query id -o tsv)) {
    Az appservice plan create --name $plan --resource-group $ResourceGroup --location $Location --is-linux --sku $Sku -o none
}
if (-not (Az -AllowFail webapp show --name $AppName --resource-group $ResourceGroup --query id -o tsv)) {
    Az webapp create --name $AppName --resource-group $ResourceGroup --plan $plan --runtime "NODE:22-lts" -o none
}
Az webapp update --name $AppName --resource-group $ResourceGroup --https-only true -o none
Az webapp config set --name $AppName --resource-group $ResourceGroup --startup-file "node dist/src/cli/index.js serve" --always-on true --min-tls-version 1.2 --ftps-state Disabled --http20-enabled true -o none
Ok "Web app $AppName in $ResourceGroup ($Location, $Sku)"

# ------------------------------------------------------------------ 5. settings
Step 5 'App settings'
$current = Az webapp config appsettings list --name $AppName --resource-group $ResourceGroup -o json | ConvertFrom-Json
$has = @{}
foreach ($s in $current) { $has[$s.name] = $true }

$settings = [ordered]@{
    PCX_MODE                       = 'hosted'
    PCX_TENANT_ID                  = $tenantId
    PCX_CLIENT_ID                  = $appId
    PCX_PUBLIC_URL                 = $publicUrl
    PCX_ENVIRONMENTS               = ($envs | Select-Object name, url, managed | ConvertTo-Json -Compress -AsArray)
    PCX_ACTION_LOG                 = '/home/pcx/actions.log'
    SCM_DO_BUILD_DURING_DEPLOYMENT = 'false'
}
if (-not $has['PCX_SESSION_SECRET']) {
    $bytes = New-Object byte[] 48
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $settings['PCX_SESSION_SECRET'] = [Convert]::ToBase64String($bytes)
}
if ($RotateSecret -or -not $has['PCX_CLIENT_SECRET']) {
    $settings['PCX_CLIENT_SECRET'] = Az ad app credential reset --id $appId --append --display-name "pcx-$(Get-Date -Format yyyyMMdd)" --years 1 --query password -o tsv
    Info 'New client secret created (valid 1 year) and stored only in the web app settings.'
}
$list = @($settings.GetEnumerator() | ForEach-Object { @{ name = $_.Key; value = [string]$_.Value; slotSetting = $false } })
$file = Write-JsonFile $list
try { Az webapp config appsettings set --name $AppName --resource-group $ResourceGroup --settings "@$file" -o none }
finally { Remove-Item $file -ErrorAction SilentlyContinue }
Ok "$($envs.Count) environments: $(($envs | ForEach-Object { $_.name }) -join ', ')"

# ------------------------------------------------------------------ 6. deploy
Step 6 'Deploying'
Az webapp deploy --name $AppName --resource-group $ResourceGroup --src-path $zip --type zip -o none
Remove-Item -Recurse -Force $stage, $zip -ErrorAction SilentlyContinue
Ok 'Deployed'

Write-Host ''
Write-Host "  Env Console is live: $publicUrl" -ForegroundColor Green
Info 'People sign in with their own account; what they can see and change follows their Dataverse security roles.'
Info 'Each person needs a user record in each environment, as they would for the maker portal.'
Info "To redeploy after an update, run this script again with the same -AppName."
