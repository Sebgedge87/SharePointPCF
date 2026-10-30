import type { EnvConfig, PcxConfig } from "./config.js";
import { AuthError, createProvider, TokenCache, type TokenSource } from "./auth.js";
import { DataverseClient, type ClientOptions } from "./dataverse.js";

export interface EnvStatus {
  name: string;
  url: string;
  managed: boolean;
  connected: boolean;
  needsLogin?: boolean;
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
    private readonly clientOptions: ClientOptions = {}
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
    client.getAll<{ solutionid: string }>("solutions?$select=solutionid&$filter=isvisible eq true"),
    client.getAll<{ statecode: number }>("workflows?$select=statecode&$filter=category eq 5 and type eq 1"),
    client.getAll<{ statecode: number }>("sdkmessageprocessingsteps?$select=statecode&$filter=customizationlevel eq 1 and ishidden/Value eq false")
  ]);
  const [ver, sols, flows, steps] = settled;
  if (ver.status === "fulfilled") base.version = ver.value.Version;
  if (sols.status === "fulfilled") base.solutions = sols.value.length;
  if (flows.status === "fulfilled") {
    base.flowsTotal = flows.value.length;
    base.flowsOn = flows.value.filter((f) => f.statecode === 1).length;
  }
  if (steps.status === "fulfilled") {
    base.pluginStepsTotal = steps.value.length;
    base.pluginStepsOn = steps.value.filter((s) => s.statecode === 0).length;
  }
  const failed = settled.find((s) => s.status === "rejected") as PromiseRejectedResult | undefined;
  if (failed) base.error = `Some details could not be read: ${(failed.reason as Error).message}`;
  return base;
}
