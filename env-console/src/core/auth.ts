import { isValidTenant, normaliseResource, type AuthProviderName } from "./config.js";
import { runCapturing, runInteractive, runProcess, type CapturedProcess, type CapturingRunner, type InteractiveRunner, type Runner } from "./proc.js";

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
  /** Signs out of the borrowed session. */
  logout(): Promise<void>;
  /** Starts a sign-in with a code (no window on this machine). Optional. */
  startDeviceLogin?(tenantId?: string): Promise<DeviceLogin>;
}

/** A sign-in waiting for the user to enter `code` at `url`. */
export interface DeviceLogin {
  code: string;
  url: string;
  /** Resolves when the user has finished signing in; rejects if it fails or times out. */
  done: Promise<void>;
  cancel(): void;
}

const CODE_RE = /enter the code\s+([A-Z0-9-]{6,12})/i;
const URL_RE = /(https:\/\/(?:www\.)?(?:microsoft\.com\/devicelogin|login\.microsoft\.com\/device|aka\.ms\/devicelogin))/i;

/** Runs a device-code sign-in command and resolves once the code appears in its output. */
function deviceLoginFrom(start: (onOutput: (t: string) => void) => CapturedProcess, toolName: string): Promise<DeviceLogin> {
  return new Promise((resolveStart, rejectStart) => {
    let buf = "";
    let started = false;
    const proc = start((t) => {
      // eslint-disable-next-line no-control-regex
      buf += t.replace(/\x1b\[[0-9;]*m/g, "");
      if (started) return;
      const code = CODE_RE.exec(buf)?.[1];
      if (code) {
        started = true;
        resolveStart({
          code,
          url: URL_RE.exec(buf)?.[1] ?? "https://microsoft.com/devicelogin",
          done: proc.done.then((r) => {
            if (r.code !== 0) throw new AuthError(`${toolName} sign-in did not complete`);
          }),
          cancel: () => proc.kill()
        });
      }
    });
    const output = () => buf.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(-8).join("\n") || "(no output)";
    const timer = setTimeout(() => {
      if (!started) {
        proc.kill();
        rejectStart(new DeviceLoginError(`${toolName} did not show a sign-in code within 30 seconds.`, output()));
      }
    }, 30_000);
    proc.done.then((r) => {
      clearTimeout(timer);
      if (!started) rejectStart(r.notFound ? new AuthError(`${toolName} was not found.`) : new DeviceLoginError(`${toolName} stopped before showing a sign-in code.`, output()));
    });
  });
}

/** A code sign-in that failed to start; `output` is what the tool printed, for diagnosis. */
export class DeviceLoginError extends Error {
  constructor(
    message: string,
    readonly output: string
  ) {
    super(message);
  }
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

const PS_LOGOUT = `
$ErrorActionPreference = 'SilentlyContinue'
Import-Module Az.Accounts
Disconnect-AzAccount | Out-Null
Clear-AzContext -Force | Out-Null
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
# The sign-in code arrives as a warning or host message: pass every message on as plain text, straight away.
if ($p.UseDeviceAuthentication) {
  try { $PSStyle.OutputRendering = 'PlainText' } catch { }
  Connect-AzAccount @p *>&1 | ForEach-Object {
    if ($_ -is [System.Management.Automation.WarningRecord] -or $_ -is [System.Management.Automation.InformationRecord] -or $_ -is [System.Management.Automation.ErrorRecord] -or $_ -is [string]) {
      [Console]::Out.WriteLine([string]$_); [Console]::Out.Flush()
    }
  }
}
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
    private readonly shells: string[] = process.platform === "win32" ? ["pwsh", "powershell"] : ["pwsh"],
    private readonly capture: CapturingRunner = runCapturing
  ) {}

  startDeviceLogin(tenantId?: string): Promise<DeviceLogin> {
    checkTenant(tenantId);
    const env = { ...process.env, PCX_TENANT: tenantId ?? "", PCX_DEVICE: "1" };
    return deviceLoginFrom((onOut) => this.capture(this.shells[0]!, ["-NoProfile", "-OutputFormat", "Text", "-EncodedCommand", encodePs(PS_LOGIN)], onOut, { env }), "PowerShell");
  }

  async getToken(resource: string, tenantId?: string): Promise<AccessToken> {
    const res = normaliseResource(resource);
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

  async logout(): Promise<void> {
    for (const shell of this.shells) {
      const r = await this.run(shell, ["-NoProfile", "-NonInteractive", "-OutputFormat", "Text", "-EncodedCommand", encodePs(PS_LOGOUT)]);
      if (!r.notFound) return;
    }
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
    private readonly cmd: string = process.platform === "win32" ? "az.cmd" : "az",
    private readonly capture: CapturingRunner = runCapturing
  ) {}

  startDeviceLogin(tenantId?: string): Promise<DeviceLogin> {
    checkTenant(tenantId);
    const args = ["login", "--allow-no-subscriptions", "--use-device-code"];
    if (tenantId) args.push("--tenant", tenantId);
    return deviceLoginFrom((onOut) => this.capture(this.cmd, args, onOut), "Azure CLI");
  }

  async getToken(resource: string, tenantId?: string): Promise<AccessToken> {
    const res = normaliseResource(resource);
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

  async logout(): Promise<void> {
    await this.run(this.cmd, ["logout"]);
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
    private tenantId?: string,
    private readonly now: () => number = Date.now
  ) {}

  /** Switch tenant (e.g. after the tenant setting changes); drops cached tokens. */
  setTenant(tenantId?: string): void {
    this.tenantId = tenantId;
    this.cache.clear();
  }

  async token(resource: string): Promise<string> {
    const key = normaliseResource(resource);
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
