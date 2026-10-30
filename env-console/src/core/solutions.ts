import type { DataverseClient } from "./dataverse.js";

export interface Publisher {
  uniqueName: string;
  friendlyName: string;
  prefix: string;
}

export interface Solution {
  id: string;
  uniqueName: string;
  friendlyName: string;
  version: string;
  isManaged: boolean;
  installedOn?: string;
  publisher: Publisher;
}

interface RawSolution {
  solutionid: string;
  uniquename: string;
  friendlyname: string;
  version: string;
  ismanaged: boolean;
  installedon?: string;
  publisherid?: { uniquename?: string; friendlyname?: string; customizationprefix?: string } | null;
}

// Internal system solutions that every environment has and nobody manages by hand.
const HIDDEN = new Set(["Default", "Active", "Basic"]);

export async function listSolutions(client: DataverseClient): Promise<Solution[]> {
  const rows = await client.getAll<RawSolution>(
    "solutions?$select=solutionid,uniquename,friendlyname,version,ismanaged,installedon" +
      "&$expand=publisherid($select=uniquename,friendlyname,customizationprefix)" +
      "&$filter=isvisible eq true&$orderby=friendlyname"
  );
  return rows
    .filter((r) => !HIDDEN.has(r.uniquename))
    .map((r) => ({
      id: r.solutionid,
      uniqueName: r.uniquename,
      friendlyName: r.friendlyname,
      version: r.version,
      isManaged: r.ismanaged,
      installedOn: r.installedon,
      publisher: {
        uniqueName: r.publisherid?.uniquename ?? "",
        friendlyName: r.publisherid?.friendlyname ?? "",
        prefix: r.publisherid?.customizationprefix ?? ""
      }
    }));
}

const MS_PUBLISHERS = new Set(["microsoftcorporation", "microsoftdynamics", "dynamics365", "msdynce", "microsoftfirstparty", "microsoftdynamicscrm"]);
const MS_PREFIXES = new Set(["msdyn", "msdynce", "mspp", "msfp", "adx", "msa", "mspcat", "msdynmkt", "mserp"]);

/** Best guess at Microsoft first-party publishers, so they can be hidden by default. */
export function isMicrosoftPublisher(p: Publisher): boolean {
  return MS_PUBLISHERS.has(p.uniqueName.toLowerCase()) || MS_PREFIXES.has(p.prefix.toLowerCase()) || /^microsoft\b/i.test(p.friendlyName);
}

/** Compares dotted versions numerically: 1.10.0.0 > 1.9.0.0. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

export interface MatrixCell {
  version: string;
  isManaged: boolean;
}

export interface MatrixRow {
  uniqueName: string;
  friendlyName: string;
  publisher: Publisher;
  isMicrosoft: boolean;
  /** Keyed by environment name; null = not installed there. */
  versions: Record<string, MatrixCell | null>;
  /** Installed versions are not all the same, or it is missing somewhere. */
  differs: boolean;
}

export function buildMatrix(envNames: string[], perEnv: Record<string, Solution[]>): MatrixRow[] {
  const rows = new Map<string, MatrixRow>();
  for (const env of envNames) {
    for (const s of perEnv[env] ?? []) {
      let row = rows.get(s.uniqueName);
      if (!row) {
        row = { uniqueName: s.uniqueName, friendlyName: s.friendlyName, publisher: s.publisher, isMicrosoft: isMicrosoftPublisher(s.publisher), versions: {}, differs: false };
        rows.set(s.uniqueName, row);
      }
      row.versions[env] = { version: s.version, isManaged: s.isManaged };
    }
  }
  const loaded = envNames.filter((e) => perEnv[e] !== undefined);
  for (const row of rows.values()) {
    for (const env of loaded) if (!(env in row.versions)) row.versions[env] = null;
    const vs = loaded.map((e) => row.versions[e]?.version ?? null);
    row.differs = vs.some((v) => v !== vs[0]);
  }
  return [...rows.values()].sort((a, b) => a.friendlyName.localeCompare(b.friendlyName));
}

export interface SolutionFilter {
  /** Matches publisher unique name, display name or prefix, case-insensitive. Any match keeps the row. */
  publishers?: string[];
  includeMicrosoft?: boolean;
  search?: string;
  diffOnly?: boolean;
}

export function filterMatrix(rows: MatrixRow[], f: SolutionFilter): MatrixRow[] {
  const pubs = (f.publishers ?? []).map((p) => p.toLowerCase()).filter(Boolean);
  const q = (f.search ?? "").trim().toLowerCase();
  return rows.filter((r) => {
    const pubMatch = pubs.length > 0 && pubs.some((p) => [r.publisher.uniqueName, r.publisher.friendlyName, r.publisher.prefix].some((v) => v.toLowerCase() === p));
    if (pubs.length > 0 && !pubMatch) return false;
    // A Microsoft publisher asked for by name is shown even when Microsoft solutions are hidden.
    if (r.isMicrosoft && !f.includeMicrosoft && !pubMatch) return false;
    if (q && !`${r.friendlyName} ${r.uniqueName}`.toLowerCase().includes(q)) return false;
    if (f.diffOnly && !r.differs) return false;
    return true;
  });
}

export interface PublisherCount {
  publisher: Publisher;
  isMicrosoft: boolean;
  count: number;
}

export function publisherCounts(rows: MatrixRow[]): PublisherCount[] {
  const m = new Map<string, PublisherCount>();
  for (const r of rows) {
    const k = r.publisher.uniqueName || r.publisher.friendlyName;
    const c = m.get(k) ?? { publisher: r.publisher, isMicrosoft: r.isMicrosoft, count: 0 };
    c.count++;
    m.set(k, c);
  }
  return [...m.values()].sort((a, b) => Number(a.isMicrosoft) - Number(b.isMicrosoft) || b.count - a.count);
}
