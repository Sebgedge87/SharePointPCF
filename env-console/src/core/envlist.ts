import type { TokenSource } from "./auth.js";
import { normaliseEnvUrl, type EnvConfig, type PcxConfig } from "./config.js";
import { discoverEnvironments, suggestName, type DiscoveredEnv } from "./discovery.js";
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

/** Loads every reachable environment, only when "discovery" is switched on. Never throws. */
export async function addDiscovered(config: PcxConfig, tokens: TokenSource, fetchImpl?: FetchLike): Promise<DiscoveryResult> {
  if (config.discovery !== true) return { added: [] };
  try {
    return { added: mergeDiscovered(config, await discoverEnvironments(tokens, fetchImpl)) };
  } catch (e) {
    return { added: [], error: (e as Error).message };
  }
}

/** Does this discovered environment match what was typed for --env (display name, unique name or URL)? */
function matches(f: DiscoveredEnv, want: string): boolean {
  const w = want.trim().toLowerCase();
  if (f.friendlyName.toLowerCase() === w || (f.uniqueName && f.uniqueName.toLowerCase() === w)) return true;
  try {
    const host = new URL(w.includes("://") ? w : `https://${w}`).hostname;
    return host.includes(".") && new URL(f.url).hostname === host;
  } catch {
    return false;
  }
}

/**
 * Makes environments named with --env usable even if they weren't chosen: looks them up through the
 * Discovery service and adds just those (in memory, never saved). Names already known are left alone.
 */
export async function resolveUnsaved(config: PcxConfig, wanted: string[], tokens: TokenSource, fetchImpl?: FetchLike): Promise<DiscoveryResult> {
  const known = (w: string) => {
    const u = w.trim().toUpperCase();
    return config.environments.some((e) => e.name.toUpperCase() === u || e.label?.toUpperCase() === u || (w.includes(".") && w.toLowerCase().includes(new URL(e.url).hostname)));
  };
  const missing = wanted.filter((w) => w.trim() && !known(w));
  if (!missing.length) return { added: [] };
  let found: DiscoveredEnv[];
  try {
    found = await discoverEnvironments(tokens, fetchImpl);
  } catch (e) {
    return { added: [], error: (e as Error).message };
  }
  const picked = found.filter((f) => f.enabled && missing.some((w) => matches(f, w)));
  const taken = config.environments.map((e) => e.name);
  const added: EnvConfig[] = [];
  for (const f of picked) {
    if (config.environments.some((e) => e.url === f.url)) continue;
    const base = f.friendlyName && f.friendlyName !== f.url ? f.friendlyName : new URL(f.url).hostname.split(".")[0]!;
    const env: EnvConfig = { name: uniqueShortName(base, taken), label: f.friendlyName, url: f.url, managed: f.suggestedManaged, discovered: true };
    taken.push(env.name);
    config.environments.push(env);
    added.push(env);
  }
  return { added };
}

/** The new chosen list: environments already saved keep their settings; new ones get a short name and type. */
export function chooseEnvironments(config: PcxConfig, picks: { url: string; label?: string; managed?: boolean }[]): EnvConfig[] {
  const saved = config.environments.filter((e) => !e.discovered);
  const out: EnvConfig[] = [];
  for (const p of picks) {
    const url = normaliseEnvUrl(p.url, undefined);
    const have = saved.find((e) => e.url === url);
    if (have) {
      out.push(have);
      continue;
    }
    const s = suggestName(p.label ?? "", url);
    out.push({ name: uniqueShortName(p.label || s.name, [...out, ...saved].map((e) => e.name)), label: p.label, url, managed: p.managed ?? s.managed });
  }
  return out;
}

