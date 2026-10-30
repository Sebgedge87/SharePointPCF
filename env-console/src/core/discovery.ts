import type { TokenSource } from "./auth.js";
import { normaliseEnvUrl } from "./config.js";

/** Global Discovery Service (commercial cloud): lists the Dataverse environments the signed-in user can reach. */
export const DISCOVERY_URL = "https://globaldisco.crm.dynamics.com";

export interface DiscoveredEnv {
  friendlyName: string;
  uniqueName: string;
  url: string;
  environmentId?: string;
  region?: string;
  version?: string;
  enabled: boolean;
  /** Short name we suggest (DEV, TEST, UAT, PREPROD, PROD or a cleaned-up name). */
  suggestedName: string;
  /** DEV-like environments are suggested as unmanaged. */
  suggestedManaged: boolean;
}

interface RawInstance {
  FriendlyName?: string;
  UniqueName?: string;
  UrlName?: string;
  Url?: string;
  EnvironmentId?: string;
  Region?: string;
  Version?: string;
  State?: number;
}

type FetchLike = (url: string, init: { headers: Record<string, string> }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

const PATTERNS: [RegExp, string][] = [
  [/\b(pre[-_ ]?prod|preprod|staging|stage)\b/i, "PREPROD"],
  [/\b(uat|acceptance)\b/i, "UAT"],
  [/\b(test|tst|qa|sit)\b/i, "TEST"],
  [/\b(dev|develop|development|sandbox)\b/i, "DEV"],
  [/\b(prod|production|live)\b/i, "PROD"]
];

/** Suggests a short environment name from its display name and URL. */
export function suggestName(friendlyName: string, url: string): { name: string; managed: boolean } {
  const host = new URL(url).hostname.split(".")[0] ?? "";
  const text = `${friendlyName} ${host.replace(/-/g, " ")}`;
  for (const [re, name] of PATTERNS) if (re.test(text)) return { name, managed: name !== "DEV" };
  const cleaned = (friendlyName || host).toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32) || "ENV";
  return { name: cleaned, managed: true };
}

export async function discoverEnvironments(tokens: TokenSource, fetchImpl: FetchLike = globalThis.fetch as unknown as FetchLike): Promise<DiscoveredEnv[]> {
  const token = await tokens.token(DISCOVERY_URL);
  const res = await fetchImpl(`${DISCOVERY_URL}/api/discovery/v2.0/Instances`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
  const text = await res.text();
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      msg = (JSON.parse(text) as { error?: { message?: string } }).error?.message ?? msg;
    } catch {
      /* keep status */
    }
    throw new Error(`Could not list your environments: ${msg}`);
  }
  const rows = (JSON.parse(text) as { value?: RawInstance[] }).value ?? [];
  const out: DiscoveredEnv[] = [];
  for (const r of rows) {
    let url: string;
    try {
      url = normaliseEnvUrl(r.Url ?? "");
    } catch {
      continue; // not a host we would send tokens to
    }
    const s = suggestName(r.FriendlyName ?? "", url);
    out.push({
      friendlyName: r.FriendlyName || r.UniqueName || url,
      uniqueName: r.UniqueName || r.UrlName || "",
      url,
      environmentId: r.EnvironmentId,
      region: r.Region,
      version: r.Version,
      enabled: r.State === undefined || r.State === 0,
      suggestedName: s.name,
      suggestedManaged: s.managed
    });
  }
  return out.sort((a, b) => a.friendlyName.localeCompare(b.friendlyName));
}
