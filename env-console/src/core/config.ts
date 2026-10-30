import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

export type AuthProviderName = "azps" | "azcli";

export interface EnvConfig {
  /** Short name shown everywhere, e.g. DEV, UAT, PROD. */
  name: string;
  /** Environment URL, normalised to its origin: https://org.crm11.dynamics.com */
  url: string;
  /** Managed environments (everything after DEV) require a reason for every change. */
  managed: boolean;
}

export interface PcxConfig {
  /** Entra tenant ID or domain. Optional; the signed-in default tenant is used when empty. */
  tenantId?: string;
  auth: { provider: AuthProviderName };
  environments: EnvConfig[];
  /** Extra host suffixes to allow, for sovereign clouds. Defaults cover public, GCC, China. */
  allowedHostSuffixes?: string[];
  /** Where `pcx alerts run --post` sends new alerts. */
  alerts?: { teamsWebhook?: string };
}

/** Tokens are only ever requested for, and sent to, hosts ending in one of these. */
export const DEFAULT_HOST_SUFFIXES = [
  ".dynamics.com",
  ".dynamics.cn",
  ".microsoftdynamics.us",
  ".appsplatform.us",
  ".microsoftdynamics.de"
];

const NAME_RE = /^[A-Za-z0-9_-]{1,32}$/;
const TENANT_RE = /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+)$/;

export class ConfigError extends Error {}

export function defaultConfigPath(): string {
  if (process.env.PCX_CONFIG) return resolve(process.env.PCX_CONFIG);
  const local = resolve("pcx.config.json");
  if (existsSync(local)) return local;
  return join(homedir(), ".pcx", "config.json");
}

export function emptyConfig(): PcxConfig {
  return { auth: { provider: "azps" }, environments: [] };
}

export function normaliseEnvUrl(raw: string, suffixes: string[] = DEFAULT_HOST_SUFFIXES): string {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw new ConfigError(`Not a valid URL: ${raw}`);
  }
  if (u.protocol !== "https:") throw new ConfigError(`Environment URL must use https: ${raw}`);
  if (u.username || u.password || u.port) throw new ConfigError(`Environment URL must not contain a user, password or port: ${raw}`);
  const host = u.hostname.toLowerCase();
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host)) throw new ConfigError(`Invalid host: ${host}`);
  if (!suffixes.some((s) => host.endsWith(s.toLowerCase()))) {
    throw new ConfigError(`Host ${host} is not a Dataverse host (allowed: ${suffixes.join(", ")}). Add it to allowedHostSuffixes if this is a sovereign cloud.`);
  }
  return `https://${host}`;
}

export function validateConfig(input: unknown): PcxConfig {
  if (!input || typeof input !== "object") throw new ConfigError("Config must be a JSON object");
  const c = input as Record<string, unknown>;
  const authIn = (c.auth ?? { provider: "azps" }) as Record<string, unknown>;
  const provider = authIn.provider ?? "azps";
  if (provider !== "azps" && provider !== "azcli") throw new ConfigError(`auth.provider must be "azps" or "azcli", got ${String(provider)}`);
  let tenantId: string | undefined;
  if (c.tenantId !== undefined && c.tenantId !== "") {
    if (typeof c.tenantId !== "string" || !TENANT_RE.test(c.tenantId)) throw new ConfigError("tenantId must be a GUID or a domain like contoso.onmicrosoft.com");
    tenantId = c.tenantId;
  }
  let suffixes = DEFAULT_HOST_SUFFIXES;
  if (c.allowedHostSuffixes !== undefined) {
    if (!Array.isArray(c.allowedHostSuffixes) || !c.allowedHostSuffixes.every((s) => typeof s === "string" && /^\.[a-z0-9.-]+$/i.test(s))) {
      throw new ConfigError("allowedHostSuffixes must be a list like [\".dynamics.com\"]");
    }
    suffixes = [...DEFAULT_HOST_SUFFIXES, ...(c.allowedHostSuffixes as string[])];
  }
  const envsIn = c.environments ?? [];
  if (!Array.isArray(envsIn)) throw new ConfigError("environments must be a list");
  const seen = new Set<string>();
  const environments: EnvConfig[] = envsIn.map((e, i) => {
    const r = (e ?? {}) as Record<string, unknown>;
    if (typeof r.name !== "string" || !NAME_RE.test(r.name)) throw new ConfigError(`environments[${i}].name must be 1-32 letters, digits, _ or -`);
    const key = r.name.toUpperCase();
    if (seen.has(key)) throw new ConfigError(`Duplicate environment name: ${r.name}`);
    seen.add(key);
    if (typeof r.url !== "string") throw new ConfigError(`environments[${i}].url is required`);
    return { name: r.name, url: normaliseEnvUrl(r.url, suffixes), managed: r.managed === undefined ? true : r.managed === true };
  });
  const out: PcxConfig = { auth: { provider }, environments };
  const alertsIn = c.alerts as Record<string, unknown> | undefined;
  if (alertsIn && typeof alertsIn === "object" && typeof alertsIn.teamsWebhook === "string" && alertsIn.teamsWebhook) {
    const u = (() => {
      try {
        return new URL(alertsIn.teamsWebhook as string);
      } catch {
        throw new ConfigError("alerts.teamsWebhook is not a valid URL");
      }
    })();
    if (u.protocol !== "https:") throw new ConfigError("alerts.teamsWebhook must use https");
    out.alerts = { teamsWebhook: u.toString() };
  }
  if (tenantId) out.tenantId = tenantId;
  if (c.allowedHostSuffixes) out.allowedHostSuffixes = c.allowedHostSuffixes as string[];
  return out;
}

export function loadConfig(path = defaultConfigPath()): PcxConfig {
  if (!existsSync(path)) return emptyConfig();
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    throw new ConfigError(`Could not read ${path}: ${(e as Error).message}`);
  }
  return validateConfig(parsed);
}

export function saveConfig(config: PcxConfig, path = defaultConfigPath()): void {
  const valid = validateConfig(config);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, JSON.stringify(valid, null, 2) + "\n", { mode: 0o600 });
}

export function findEnv(config: PcxConfig, name: string): EnvConfig {
  const env = config.environments.find((e) => e.name.toUpperCase() === name.toUpperCase());
  if (!env) {
    const known = config.environments.map((e) => e.name).join(", ") || "none configured";
    throw new ConfigError(`Unknown environment "${name}". Known: ${known}`);
  }
  return env;
}

export function isValidTenant(t: string): boolean {
  return TENANT_RE.test(t);
}
