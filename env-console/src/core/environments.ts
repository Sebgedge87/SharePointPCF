import { ConfigError, DEFAULT_HOST_SUFFIXES, normaliseEnvUrl, type EnvConfig, type PcxConfig } from "./config.js";
import { suggestName } from "./discovery.js";
import { AuthError, createProvider, TokenCache, type TokenSource } from "./auth.js";
import { DataverseClient, type ClientOptions } from "./dataverse.js";

export interface EnvStatus {
  name: string;
  url: string;
  managed: boolean;
  connected: boolean;
  needsLogin?: boolean;
  /** The environment's display name in Dataverse. */
  displayName?: string;
  error?: string;
  user?: string;
  version?: string;
  solutions?: number;
  flowsOn?: number;
  flowsTotal?: number;
  pluginStepsOn?: number;
  pluginStepsTotal?: number;
}

/** Everything a command or the dashboard needs: config, a token cache and a client per environment. */
export class Workspace {
  readonly tokens: TokenSource;
  private readonly clients = new Map<string, DataverseClient>();

  constructor(
    readonly config: PcxConfig,
    tokens?: TokenSource,
    readonly clientOptions: ClientOptions = {}
  ) {
    this.tokens = tokens ?? new TokenCache(createProvider(config.auth.provider), config.tenantId);
  }

  client(env: EnvConfig): DataverseClient {
    let c = this.clients.get(env.name);
    if (!c) {
      c = new DataverseClient(env, this.tokens, this.clientOptions);
      this.clients.set(env.name, c);
    }
    return c;
  }
}

export async function whoAmI(client: DataverseClient): Promise<{ userId: string; user: string }> {
  const w = await client.get<{ UserId: string }>("WhoAmI");
  const u = await client.get<{ fullname?: string; domainname?: string }>(`systemusers(${w.UserId})?$select=fullname,domainname`);
  return { userId: w.UserId, user: u.domainname || u.fullname || w.UserId };
}

export async function envStatus(ws: Workspace, env: EnvConfig, detail = true): Promise<EnvStatus> {
  const base: EnvStatus = { name: env.name, url: env.url, managed: env.managed, connected: false };
  const client = ws.client(env);
  try {
    const me = await whoAmI(client);
    base.connected = true;
    base.user = me.user;
  } catch (e) {
    base.error = (e as Error).message;
    base.needsLogin = e instanceof AuthError && e.needsLogin;
    return base;
  }
  if (!detail) return base;
  const settled = await Promise.allSettled([
    client.get<{ Version: string }>("RetrieveVersion"),
    client.get<{ Detail?: { FriendlyName?: string } }>("RetrieveCurrentOrganization(AccessType=@p)?@p=Microsoft.Dynamics.CRM.EndpointAccessType'Default'"),
    client.getAll<{ solutionid: string }>("solutions?$select=solutionid&$filter=isvisible eq true"),
    client.getAll<{ statecode: number }>("workflows?$select=statecode&$filter=category eq 5 and type eq 1"),
    client.getAll<{ statecode: number }>("sdkmessageprocessingsteps?$select=statecode&$filter=customizationlevel eq 1 and ishidden/Value eq false")
  ]);
  const [ver, org, sols, flows, steps] = settled;
  if (ver.status === "fulfilled") base.version = ver.value.Version;
  if (org.status === "fulfilled" && org.value.Detail?.FriendlyName) base.displayName = org.value.Detail.FriendlyName;
  if (sols.status === "fulfilled") base.solutions = sols.value.length;
  if (flows.status === "fulfilled") {
    base.flowsTotal = flows.value.length;
    base.flowsOn = flows.value.filter((f) => f.statecode === 1).length;
  }
  if (steps.status === "fulfilled") {
    base.pluginStepsTotal = steps.value.length;
    base.pluginStepsOn = steps.value.filter((s) => s.statecode === 0).length;
  }
  // The display-name lookup is a nice-to-have; only real data failures are reported.
  const failed = settled.filter((_, i) => i !== 1).find((s) => s.status === "rejected") as PromiseRejectedResult | undefined;
  if (failed) base.error = `Some details could not be read: ${(failed.reason as Error).message}`;
  return base;
}

/** The environment's display name from Dataverse, or undefined if it can't be read. */
export async function lookupDisplayName(client: DataverseClient): Promise<string | undefined> {
  try {
    const r = await client.get<{ Detail?: { FriendlyName?: string } }>("RetrieveCurrentOrganization(AccessType=@p)?@p=Microsoft.Dynamics.CRM.EndpointAccessType'Default'");
    return r.Detail?.FriendlyName || undefined;
  } catch {
    return undefined;
  }
}

/** A short name for `--env` that isn't already taken: UAT, UAT-2, … */
export function uniqueShortName(base: string, taken: string[]): string {
  const used = new Set(taken.map((t) => t.toUpperCase()));
  const clean = base.toUpperCase().replace(/[^A-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 28) || "ENV";
  let name = clean;
  for (let i = 2; used.has(name.toUpperCase()); i++) name = `${clean}-${i}`;
  return name;
}

/**
 * Builds a new environment entry from just its URL: looks up its display name, suggests a short
 * name and whether it's managed (DEV-like environments are unmanaged).
 */
export async function environmentFromUrl(ws: Workspace, url: string, opts: { managed?: boolean; label?: string; name?: string } = {}): Promise<EnvConfig> {
  const normalised = normaliseEnvUrl(url, ws.config.allowedHostSuffixes ? [...DEFAULT_HOST_SUFFIXES, ...ws.config.allowedHostSuffixes] : undefined);
  if (ws.config.environments.some((e) => e.url === normalised)) throw new ConfigError(`${normalised} is already in the console`);
  const probe: EnvConfig = { name: "NEW", url: normalised, managed: true };
  const label = opts.label || (await lookupDisplayName(new DataverseClient(probe, ws.tokens, ws.clientOptions))) || new URL(normalised).hostname.split(".")[0]!;
  const suggestion = suggestName(label, normalised);
  const env: EnvConfig = {
    name: opts.name || uniqueShortName(suggestion.name, ws.config.environments.map((e) => e.name)),
    label,
    url: normalised,
    managed: opts.managed ?? suggestion.managed
  };
  return env;
}
