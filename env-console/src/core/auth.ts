import { isValidTenant, normaliseEnvUrl, type AuthProviderName } from "./config.js";
import { runInteractive, runProcess, type InteractiveRunner, type Runner } from "./proc.js";

export interface AccessToken {
  token: string;
  expiresOn: Date;
}

export interface TokenProvider {
  readonly name: AuthProviderName;
  /** Gets a token for a Dataverse environment URL (the resource). */
  getToken(resource: string, tenantId?: string): Promise<AccessToken>;
  /** Signs in interactively in this terminal. */
  login(tenantId?: string, deviceCode?: boolean): Promise<void>;
}

export class AuthError extends Error {
  constructor(message: string, readonly needsLogin = false) {
    super(message);
  }
}

function checkTenant(tenantId?: string): void {
  if (tenantId && !isValidTenant(tenantId)) throw new AuthError(`Invalid tenant: ${tenantId}`);
}

/** Last line of output that parses as a JSON object (tools may print warnings first). */
function lastJson(stdout: string): Record<string, unknown> | undefined {
  const lines = stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).reverse();
  for (const l of lines) {
    if (!l.startsWith("{")) continue;
    try {
      return JSON.parse(l) as Record<string, unknown>;
    } catch {
      /* keep looking */
    }
  }
  try {
    return JSON.parse(stdout) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------- PowerShell (Az.Accounts)

// Values reach the script through environment variables, never by building script text.
const PS_GET_TOKEN = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Import-Module Az.Accounts -ErrorAction Stop
# Use the browser, not the Windows sign-in prompt (WAM), which often fails to show when started from another program.
try { Update-AzConfig -EnableLoginByWam $false -Scope Process -WarningAction SilentlyContinue | Out-Null } catch { }
$p = @{ ResourceUrl = $env:PCX_RESOURCE }
if ($env:PCX_TENANT) { $p.TenantId = $env:PCX_TENANT }
$t = Get-AzAccessToken @p -WarningAction SilentlyContinue
$tok = $t.Token
if ($tok -is [System.Security.SecureString]) { $tok = [System.Net.NetworkCredential]::new('', $tok).Password }
[pscustomobject]@{ token = $tok; expiresOn = $t.ExpiresOn.UtcDateTime.ToString('o') } | ConvertTo-Json -Compress
`;

const PS_LOGIN = `
$ErrorActionPreference = 'Stop'
Import-Module Az.Accounts -ErrorAction Stop
# Use the browser, not the Windows sign-in prompt (WAM), which often fails to show when started from another program.
try { Update-AzConfig -EnableLoginByWam $false -Scope Process -WarningAction SilentlyContinue | Out-Null } catch { }
$p = @{}
if ($env:PCX_TENANT) { $p.TenantId = $env:PCX_TENANT }
if ($env:PCX_DEVICE -eq '1') { $p.UseDeviceAuthentication = $true }
# pcx does not use Azure subscriptions: skip the subscription picker and the per-tenant warnings.
try { Update-AzConfig -LoginExperienceV2 Off -Scope Process -WarningAction SilentlyContinue | Out-Null } catch { }
# Device code needs its instructions shown; otherwise hide the module's banners and announcements.
if ($p.UseDeviceAuthentication) { Connect-AzAccount @p -WarningAction SilentlyContinue | Out-Null }
else { Connect-AzAccount @p -WarningAction SilentlyContinue *> $null }
$c = Get-AzContext
Write-Host ("Signed in as " + $c.Account.Id + " (tenant " + $c.Tenant.Id + ")")
`;

function encodePs(script: string): string {
  return Buffer.from(script, "utf16le").toString("base64");
}

export class PowerShellTokenProvider implements TokenProvider {
  readonly name = "azps" as const;
  constructor(
    private readonly run: Runner = runProcess,
    private readonly interactive: InteractiveRunner = runInteractive,
    private readonly shells: string[] = process.platform === "win32" ? ["pwsh", "powershell"] : ["pwsh"]
  ) {}

  async getToken(resource: string, tenantId?: string): Promise<AccessToken> {
    const res = normaliseEnvUrl(resource);
    checkTenant(tenantId);
    const env = { ...process.env, PCX_RESOURCE: res, PCX_TENANT: tenantId ?? "" };
    for (const shell of this.shells) {
      const r = await this.run(shell, ["-NoProfile", "-NonInteractive", "-OutputFormat", "Text", "-EncodedCommand", encodePs(PS_GET_TOKEN)], { env });
      if (r.notFound) continue;
      if (r.code !== 0) {
        const msg = r.stderr.trim() || r.stdout.trim();
        if (/Connect-AzAccount|Run Connect|no account|login|expired|AADSTS700082|AADSTS50173/i.test(msg)) {
          throw new AuthError("Not signed in to PowerShell (or the sign-in expired). Run: pcx auth login", true);
        }
        if (/Az\.Accounts/i.test(msg) && /not loaded|could not be found|not found/i.test(msg)) {
          throw new AuthError("The Az.Accounts PowerShell module is missing. Run in PowerShell: Install-Module Az.Accounts -Scope CurrentUser");
        }
        throw new AuthError(`PowerShell could not get a token for ${res}: ${firstLine(msg)}`);
      }
      const j = lastJson(r.stdout);
      if (!j || typeof j.token !== "string" || !j.token) throw new AuthError("PowerShell returned no token");
      const exp = new Date(String(j.expiresOn));
      return { token: j.token, expiresOn: isNaN(exp.getTime()) ? new Date(Date.now() + 30 * 60_000) : exp };
    }
    throw new AuthError("PowerShell 7 (pwsh) was not found. Install it, or set auth.provider to \"azcli\".");
  }

  async login(tenantId?: string, deviceCode = false): Promise<void> {
    checkTenant(tenantId);
    const env = { ...process.env, PCX_TENANT: tenantId ?? "", PCX_DEVICE: deviceCode ? "1" : "0" };
    for (const shell of this.shells) {
      const r = await this.interactive(shell, ["-NoProfile", "-OutputFormat", "Text", "-EncodedCommand", encodePs(PS_LOGIN)], { env });
      if (r.notFound) continue;
      if (r.code !== 0) throw new AuthError("PowerShell sign-in did not complete");
      return;
    }
    throw new AuthError("PowerShell 7 (pwsh) was not found. Install it, or set auth.provider to \"azcli\".");
  }
}

// ---------------------------------------------------------------- Azure CLI

export class AzureCliTokenProvider implements TokenProvider {
  readonly name = "azcli" as const;
  constructor(
    private readonly run: Runner = runProcess,
    private readonly interactive: InteractiveRunner = runInteractive,
    private readonly cmd: string = process.platform === "win32" ? "az.cmd" : "az"
  ) {}

  async getToken(resource: string, tenantId?: string): Promise<AccessToken> {
    const res = normaliseEnvUrl(resource);
    checkTenant(tenantId);
    const args = ["account", "get-access-token", "--resource", res, "--output", "json"];
    if (tenantId) args.push("--tenant", tenantId);
    const r = await this.run(this.cmd, args);
    if (r.notFound) throw new AuthError("Azure CLI (az) was not found. Install it, or set auth.provider to \"azps\".");
    if (r.code !== 0) {
      const msg = r.stderr.trim();
      if (/az login|AADSTS70043|AADSTS700082|refresh token|not logged in/i.test(msg)) {
        throw new AuthError("Not signed in to the Azure CLI (or the sign-in expired). Run: pcx auth login", true);
      }
      throw new AuthError(`Azure CLI could not get a token for ${res}: ${firstLine(msg)}`);
    }
    const j = lastJson(r.stdout);
    if (!j || typeof j.accessToken !== "string") throw new AuthError("Azure CLI returned no token");
    let exp: Date;
    if (typeof j.expires_on === "number") exp = new Date(j.expires_on * 1000);
    else exp = new Date(String(j.expiresOn ?? ""));
    return { token: j.accessToken, expiresOn: isNaN(exp.getTime()) ? new Date(Date.now() + 30 * 60_000) : exp };
  }

  async login(tenantId?: string, deviceCode = false): Promise<void> {
    checkTenant(tenantId);
    const args = ["login", "--allow-no-subscriptions"];
    if (tenantId) args.push("--tenant", tenantId);
    if (deviceCode) args.push("--use-device-code");
    const r = await this.interactive(this.cmd, args);
    if (r.notFound) throw new AuthError("Azure CLI (az) was not found.");
    if (r.code !== 0) throw new AuthError("Azure CLI sign-in did not complete");
  }
}

function firstLine(s: string): string {
  return (s.split(/\r?\n/).find((l) => l.trim()) ?? "unknown error").trim().slice(0, 300);
}

// ---------------------------------------------------------------- cache

/** What the Dataverse client needs: a token for its environment. */
export interface TokenSource {
  token(resource: string): Promise<string>;
}

/** Caches tokens per environment until five minutes before expiry; shares in-flight requests. */
export class TokenCache implements TokenSource {
  private readonly cache = new Map<string, AccessToken>();
  private readonly pending = new Map<string, Promise<AccessToken>>();

  constructor(
    private readonly provider: TokenProvider,
    private readonly tenantId?: string,
    private readonly now: () => number = Date.now
  ) {}

  async token(resource: string): Promise<string> {
    const key = normaliseEnvUrl(resource);
    const hit = this.cache.get(key);
    if (hit && hit.expiresOn.getTime() - this.now() > 5 * 60_000) return hit.token;
    let p = this.pending.get(key);
    if (!p) {
      p = this.provider.getToken(key, this.tenantId).finally(() => this.pending.delete(key));
      this.pending.set(key, p);
    }
    const t = await p;
    this.cache.set(key, t);
    return t.token;
  }

  clear(): void {
    this.cache.clear();
  }
}

export function createProvider(name: AuthProviderName): TokenProvider {
  return name === "azcli" ? new AzureCliTokenProvider() : new PowerShellTokenProvider();
}
