import { createHash } from "node:crypto";
import { odataString, type DataverseClient } from "./dataverse.js";
import { diffLines, prettyJson, prettyXml, type DiffLine } from "./diff.js";
import { mapLimit } from "./util.js";

/** Solution component types (solutioncomponent.componenttype) shown with friendly names. */
export const COMPONENT_TYPES: Record<number, string> = {
  1: "Table",
  2: "Column",
  3: "Relationship",
  9: "Choice",
  10: "Relationship",
  14: "Key",
  20: "Security role",
  21: "Role privilege",
  24: "Form (legacy)",
  26: "View",
  29: "Process / flow",
  31: "Report",
  36: "Email template",
  44: "Duplicate rule",
  59: "Chart",
  60: "Form",
  61: "Web resource",
  62: "Site map",
  63: "Connection role",
  65: "Hierarchy rule",
  66: "Custom control",
  70: "Field security profile",
  80: "Model-driven app",
  90: "Plugin type",
  91: "Plugin assembly",
  92: "Plugin step",
  93: "Plugin step image",
  95: "Service endpoint",
  300: "Canvas app",
  371: "Connector",
  372: "Connector",
  380: "Environment variable",
  381: "Environment variable value"
};

export function typeName(type: number, fallback?: string): string {
  return COMPONENT_TYPES[type] ?? (fallback || `Type ${type}`);
}

export interface Component {
  objectId: string;
  type: number;
  typeName: string;
  name: string;
  parent?: string;
  managed?: boolean;
  /** Has an unmanaged change on top (only meaningful in managed environments). */
  customized?: boolean;
}

interface Summary {
  msdyn_objectid: string;
  msdyn_componenttype: number;
  msdyn_componenttypename?: string;
  msdyn_name?: string;
  msdyn_displayname?: string;
  msdyn_schemaname?: string;
  msdyn_primaryentityname?: string;
  msdyn_iscustomized?: boolean;
  msdyn_ismanaged?: boolean;
}

export interface SolutionInfo {
  id: string;
  version: string;
  isManaged: boolean;
}

export async function findSolution(client: DataverseClient, uniqueName: string): Promise<SolutionInfo | null> {
  const r = await client.get<{ value: { solutionid: string; version: string; ismanaged: boolean }[] }>(
    `solutions?$select=solutionid,version,ismanaged&$filter=uniquename eq ${odataString(uniqueName)}`
  );
  const s = r.value[0];
  return s ? { id: s.solutionid, version: s.version, isManaged: s.ismanaged } : null;
}

/** The solution's components, with names. Uses the same summary table as the maker portal. */
export async function listSolutionComponents(client: DataverseClient, solutionId: string): Promise<Component[]> {
  try {
    const rows = await client.getAll<Summary>(
      `msdyn_solutioncomponentsummaries?$filter=msdyn_solutionid eq ${solutionId}` +
        "&$select=msdyn_objectid,msdyn_componenttype,msdyn_componenttypename,msdyn_name,msdyn_displayname,msdyn_schemaname,msdyn_primaryentityname,msdyn_iscustomized,msdyn_ismanaged"
    );
    return rows.map((r) => ({
      objectId: r.msdyn_objectid.toLowerCase(),
      type: r.msdyn_componenttype,
      typeName: typeName(r.msdyn_componenttype, r.msdyn_componenttypename),
      name: r.msdyn_displayname || r.msdyn_name || r.msdyn_schemaname || r.msdyn_objectid,
      parent: r.msdyn_primaryentityname || undefined,
      managed: r.msdyn_ismanaged,
      customized: r.msdyn_iscustomized
    }));
  } catch {
    // Older environments: plain component list without names.
    const rows = await client.getAll<{ objectid: string; componenttype: number }>(`solutioncomponents?$select=objectid,componenttype&$filter=_solutionid_value eq ${solutionId}`);
    return rows.map((r) => ({ objectId: r.objectid.toLowerCase(), type: r.componenttype, typeName: typeName(r.componenttype), name: r.objectid }));
  }
}

// ------------------------------------------------------------------ content

type Fetcher = (client: DataverseClient, id: string) => Promise<string>;

const one = async (client: DataverseClient, path: string): Promise<Record<string, unknown>> => client.get<Record<string, unknown>>(path);
const pick = (r: Record<string, unknown>, keys: string[]) => JSON.stringify(Object.fromEntries(keys.map((k) => [k, r[k] ?? null])), null, 2);

/** Component types whose definitions can be compared line by line. */
export const CONTENT: Record<number, Fetcher> = {
  60: async (c, id) => prettyXml(String((await one(c, `systemforms(${id})?$select=formxml`)).formxml ?? "")),
  26: async (c, id) => {
    const r = await one(c, `savedqueries(${id})?$select=fetchxml,layoutxml`);
    return `<!-- query -->\n${prettyXml(String(r.fetchxml ?? ""))}\n<!-- layout -->\n${prettyXml(String(r.layoutxml ?? ""))}`;
  },
  29: async (c, id) => {
    const r = await one(c, `workflows(${id})?$select=clientdata,xaml`);
    return r.clientdata ? prettyJson(String(r.clientdata)) : prettyXml(String(r.xaml ?? ""));
  },
  61: async (c, id) => {
    const r = await one(c, `webresourceset(${id})?$select=content,webresourcetype`);
    const t = Number(r.webresourcetype);
    const raw = Buffer.from(String(r.content ?? ""), "base64");
    // 1 HTML, 2 CSS, 3 JS, 4 XML, 9 XSL, 11 SVG, 12 RESX: text. Others (images) compare by hash only.
    return [1, 2, 3, 4, 9, 11, 12].includes(t) ? raw.toString("utf8") : `binary content, sha1 ${createHash("sha1").update(raw).digest("hex")}`;
  },
  62: async (c, id) => prettyXml(String((await one(c, `sitemaps(${id})?$select=sitemapxml`)).sitemapxml ?? "")),
  92: async (c, id) =>
    pick(await one(c, `sdkmessageprocessingsteps(${id})?$select=name,stage,mode,rank,filteringattributes,configuration,statecode,asyncautodelete,supporteddeployment`), [
      "name",
      "stage",
      "mode",
      "rank",
      "filteringattributes",
      "configuration",
      "statecode",
      "asyncautodelete",
      "supporteddeployment"
    ]),
  91: async (c, id) => pick(await one(c, `pluginassemblies(${id})?$select=name,version,publickeytoken,isolationmode`), ["name", "version", "publickeytoken", "isolationmode"]),
  380: async (c, id) => pick(await one(c, `environmentvariabledefinitions(${id})?$select=schemaname,type,defaultvalue,isrequired`), ["schemaname", "type", "defaultvalue", "isrequired"])
};

export async function componentContent(client: DataverseClient, type: number, id: string): Promise<string | null> {
  const f = CONTENT[type];
  return f ? f(client, id) : null;
}

const hash = (s: string) => createHash("sha1").update(s).digest("hex");

// ------------------------------------------------------------------ compare

export type CompareStatus = "same" | "different" | "layer" | "onlyA" | "onlyB" | "present";

export interface CompareRow {
  objectId: string;
  type: number;
  typeName: string;
  name: string;
  parent?: string;
  inA: boolean;
  inB: boolean;
  layerA: boolean;
  layerB: boolean;
  status: CompareStatus;
  /** Content can be diffed for this type. */
  diffable: boolean;
}

export interface CompareResult {
  solution: string;
  a: { env: string; version?: string; isManaged?: boolean; installed: boolean };
  b: { env: string; version?: string; isManaged?: boolean; installed: boolean };
  rows: CompareRow[];
  counts: Record<CompareStatus, number>;
  /** Content was only compared for this many components (limit reached). */
  contentLimited: boolean;
}

/** Compares one solution between two environments, component by component. */
export async function compareSolution(a: DataverseClient, b: DataverseClient, uniqueName: string, opts: { contentLimit?: number } = {}): Promise<CompareResult> {
  const [sa, sb] = await Promise.all([findSolution(a, uniqueName), findSolution(b, uniqueName)]);
  if (!sa && !sb) throw new Error(`Solution "${uniqueName}" is not installed in ${a.env.name} or ${b.env.name}`);
  const [ca, cb] = await Promise.all([sa ? listSolutionComponents(a, sa.id) : [], sb ? listSolutionComponents(b, sb.id) : []]);
  const key = (c: Component) => `${c.type}:${c.objectId}`;
  const mapA = new Map(ca.map((c) => [key(c), c]));
  const mapB = new Map(cb.map((c) => [key(c), c]));
  const keys = [...new Set([...mapA.keys(), ...mapB.keys()])];

  const rows: CompareRow[] = keys.map((k) => {
    const x = mapA.get(k);
    const y = mapB.get(k);
    const c = (x ?? y)!;
    const layerA = !!(x && a.env.managed && x.managed && x.customized);
    const layerB = !!(y && b.env.managed && y.managed && y.customized);
    return {
      objectId: c.objectId,
      type: c.type,
      typeName: c.typeName,
      name: c.name,
      parent: c.parent,
      inA: !!x,
      inB: !!y,
      layerA,
      layerB,
      status: !x ? "onlyB" : !y ? "onlyA" : "present",
      diffable: !!CONTENT[c.type]
    };
  });

  // Compare definitions where both sides have them.
  const limit = opts.contentLimit ?? 400;
  const toCheck = rows.filter((r) => r.inA && r.inB && r.diffable).slice(0, limit);
  await mapLimit(toCheck, 6, async (r) => {
    try {
      const [ta, tb] = await Promise.all([componentContent(a, r.type, r.objectId), componentContent(b, r.type, r.objectId)]);
      if (ta !== null && tb !== null) r.status = hash(ta) === hash(tb) ? "same" : "different";
    } catch {
      /* stays "present" */
    }
  });
  for (const r of rows) if ((r.layerA || r.layerB) && r.status !== "onlyA" && r.status !== "onlyB") r.status = "layer";

  const order: Record<CompareStatus, number> = { layer: 0, different: 1, onlyA: 2, onlyB: 3, present: 4, same: 5 };
  rows.sort((p, q) => order[p.status] - order[q.status] || p.typeName.localeCompare(q.typeName) || p.name.localeCompare(q.name));
  const counts = { same: 0, different: 0, layer: 0, onlyA: 0, onlyB: 0, present: 0 } as Record<CompareStatus, number>;
  rows.forEach((r) => counts[r.status]++);
  return {
    solution: uniqueName,
    a: { env: a.env.name, version: sa?.version, isManaged: sa?.isManaged, installed: !!sa },
    b: { env: b.env.name, version: sb?.version, isManaged: sb?.isManaged, installed: !!sb },
    rows,
    counts,
    contentLimited: rows.filter((r) => r.inA && r.inB && r.diffable).length > limit
  };
}

/** Line diff of one component's definition between two environments. */
export async function diffComponent(a: DataverseClient, b: DataverseClient, type: number, id: string): Promise<{ lines: DiffLine[]; changed: boolean; tooLarge?: boolean; supported: boolean }> {
  if (!CONTENT[type]) return { lines: [], changed: false, supported: false };
  const [ta, tb] = await Promise.all([componentContent(a, type, id).catch(() => ""), componentContent(b, type, id).catch(() => "")]);
  return { ...diffLines(ta ?? "", tb ?? ""), supported: true };
}
