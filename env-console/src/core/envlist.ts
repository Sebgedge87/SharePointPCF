import type { TokenSource } from "./auth.js";
import type { EnvConfig, PcxConfig } from "./config.js";
import { discoverEnvironments, type DiscoveredEnv } from "./discovery.js";
import { uniqueShortName } from "./environments.js";

type FetchLike = Parameters<typeof discoverEnvironments>[1];

/**
 * Adds every environment the signed-in user can reach (from the Discovery service) to the
 * in-memory config, next to the saved ones. Discovered entries are never saved; hidden ones are skipped.
 */
export function mergeDiscovered(config: PcxConfig, found: DiscoveredEnv[]): EnvConfig[] {
  config.environments = config.environments.filter((e) => !e.discovered);
  const have = new Set(config.environments.map((e) => e.url));
  const hidden = new Set(config.hiddenEnvironments ?? []);
  const added: EnvConfig[] = [];
  for (const f of found) {
    if (!f.enabled || have.has(f.url) || hidden.has(f.url)) continue;
    const base = f.friendlyName && f.friendlyName !== f.url ? f.friendlyName : new URL(f.url).hostname.split(".")[0]!;
    const env: EnvConfig = { name: uniqueShortName(base, config.environments.map((e) => e.name)), label: f.friendlyName, url: f.url, managed: f.suggestedManaged, discovered: true };
    config.environments.push(env);
    have.add(f.url);
    added.push(env);
  }
  return added;
}

export interface DiscoveryResult {
  added: EnvConfig[];
  /** Set when the lookup failed; the saved environments are still there. */
  error?: string;
}

/** Looks up and merges discovered environments, unless discovery is switched off. Never throws. */
export async function addDiscovered(config: PcxConfig, tokens: TokenSource, fetchImpl?: FetchLike): Promise<DiscoveryResult> {
  if (config.discovery === false) return { added: [] };
  try {
    return { added: mergeDiscovered(config, await discoverEnvironments(tokens, fetchImpl)) };
  } catch (e) {
    return { added: [], error: (e as Error).message };
  }
}
