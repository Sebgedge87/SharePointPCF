import { appendAction } from "./actionLog.js";
import { checkPolicy } from "./components.js";
import { assertGuid, type DataverseClient } from "./dataverse.js";
import { mapLimit } from "./util.js";

/** The usersettings columns pcx manages. */
export interface FormatSettings {
  localeid?: number;
  uilanguageid?: number;
  helplanguageid?: number;
  timezonecode?: number;
  dateformatstring?: string;
  dateseparator?: string;
  timeformatstring?: string;
  timeseparator?: string;
  decimalsymbol?: string;
  numberseparator?: string;
  /** 0 brackets, 1 dash, 2 dash+space, 3 trailing dash, 4 space+trailing dash */
  negativeformatcode?: number;
  /** 0 $123, 1 123$, 2 $ 123, 3 123 $ */
  currencyformatcode?: number;
  paginglimit?: number;
}

export const SETTING_KEYS: (keyof FormatSettings)[] = [
  "localeid",
  "uilanguageid",
  "helplanguageid",
  "timezonecode",
  "dateformatstring",
  "dateseparator",
  "timeformatstring",
  "timeseparator",
  "decimalsymbol",
  "numberseparator",
  "negativeformatcode",
  "currencyformatcode",
  "paginglimit"
];

/** Columns that also exist on the organization as the defaults for new users. */
const ORG_KEYS: (keyof FormatSettings)[] = ["localeid", "dateformatstring", "dateseparator", "timeformatstring", "timeseparator", "decimalsymbol", "numberseparator", "negativeformatcode", "currencyformatcode", "paginglimit"];

/** Region presets: number, currency and default date/time formats. */
export const REGIONS: Record<string, { label: string } & FormatSettings> = {
  "en-GB": { label: "English (United Kingdom)", localeid: 2057, dateformatstring: "dd/MM/yyyy", dateseparator: "/", timeformatstring: "HH:mm", timeseparator: ":", decimalsymbol: ".", numberseparator: ",", negativeformatcode: 1, currencyformatcode: 0 },
  "en-US": { label: "English (United States)", localeid: 1033, dateformatstring: "M/d/yyyy", dateseparator: "/", timeformatstring: "h:mm tt", timeseparator: ":", decimalsymbol: ".", numberseparator: ",", negativeformatcode: 0, currencyformatcode: 0 },
  "en-IE": { label: "English (Ireland)", localeid: 6153, dateformatstring: "dd/MM/yyyy", dateseparator: "/", timeformatstring: "HH:mm", timeseparator: ":", decimalsymbol: ".", numberseparator: ",", negativeformatcode: 1, currencyformatcode: 0 },
  "de-DE": { label: "German (Germany)", localeid: 1031, dateformatstring: "dd.MM.yyyy", dateseparator: ".", timeformatstring: "HH:mm", timeseparator: ":", decimalsymbol: ",", numberseparator: ".", negativeformatcode: 1, currencyformatcode: 3 },
  "fr-FR": { label: "French (France)", localeid: 1036, dateformatstring: "dd/MM/yyyy", dateseparator: "/", timeformatstring: "HH:mm", timeseparator: ":", decimalsymbol: ",", numberseparator: " ", negativeformatcode: 1, currencyformatcode: 3 }
};

/** Common Dataverse time zone codes. */
export const TIME_ZONES: Record<number, string> = {
  85: "(GMT+00:00) Dublin, Edinburgh, Lisbon, London",
  110: "(GMT+01:00) Amsterdam, Berlin, Rome, Stockholm, Vienna",
  105: "(GMT+01:00) Brussels, Copenhagen, Madrid, Paris",
  35: "(GMT-05:00) Eastern Time (US & Canada)",
  20: "(GMT-06:00) Central Time (US & Canada)",
  4: "(GMT-08:00) Pacific Time (US & Canada)",
  215: "(GMT+08:00) Singapore",
  255: "(GMT+10:00) Canberra, Melbourne, Sydney"
};

export const LANGUAGES: Record<number, string> = { 1033: "English", 1031: "German", 1036: "French", 3082: "Spanish", 1043: "Dutch" };

export function validateSettings(s: FormatSettings): FormatSettings {
  const out: FormatSettings = {};
  for (const k of SETTING_KEYS) {
    const v = s[k];
    if (v === undefined || v === null || (v as unknown) === "") continue;
    if (["dateformatstring", "timeformatstring"].includes(k)) {
      if (typeof v !== "string" || !/^[dMyHhmst/.:\- ]{1,20}$/.test(v)) throw new Error(`Invalid ${k}: ${v}`);
    } else if (["dateseparator", "timeseparator", "decimalsymbol", "numberseparator"].includes(k)) {
      if (typeof v !== "string" || v.length > 3) throw new Error(`Invalid ${k}: ${v}`);
    } else {
      const n = Number(v);
      if (!Number.isInteger(n) || n < 0) throw new Error(`Invalid ${k}: ${v}`);
      if (k === "paginglimit" && ![25, 50, 75, 100, 250].includes(n)) throw new Error("Records per page must be 25, 50, 75, 100 or 250");
    }
    (out as Record<string, unknown>)[k] = typeof v === "string" ? v : Number(v);
  }
  return out;
}

export interface UserRow {
  id: string;
  name: string;
  login: string;
  settings: FormatSettings;
  /** Settings equal the organization defaults: the user has not personalised them. */
  onDefaults: boolean;
  /** Already matches the target settings. */
  matches?: boolean;
}

export type UserScope = { kind: "all" } | { kind: "role"; name: string } | { kind: "team"; name: string } | { kind: "businessunit"; name: string };

async function scopedUserIds(client: DataverseClient, scope: UserScope): Promise<Set<string> | null> {
  if (scope.kind === "all") return null;
  const q = scope.name.replace(/'/g, "''");
  let ids: string[] = [];
  if (scope.kind === "role") {
    const r = await client.getAll<{ systemuserid: string }>(`systemuserrolescollection?$select=systemuserid&$filter=roleid/name eq '${q}'`).catch(async () => {
      const roles = await client.get<{ value: { roleid: string }[] }>(`roles?$select=roleid&$filter=name eq '${q}'`);
      const all: { systemuserid: string }[] = [];
      for (const role of roles.value) all.push(...(await client.getAll<{ systemuserid: string }>(`systemuserrolescollection?$select=systemuserid&$filter=roleid eq ${role.roleid}`)));
      return all;
    });
    ids = r.map((x) => x.systemuserid);
  } else if (scope.kind === "team") {
    const teams = await client.get<{ value: { teamid: string }[] }>(`teams?$select=teamid&$filter=name eq '${q}'`);
    for (const t of teams.value) ids.push(...(await client.getAll<{ systemuserid: string }>(`teammemberships?$select=systemuserid&$filter=teamid eq ${t.teamid}`)).map((x) => x.systemuserid));
  } else {
    const bus = await client.get<{ value: { businessunitid: string }[] }>(`businessunits?$select=businessunitid&$filter=name eq '${q}'`);
    for (const b of bus.value) ids.push(...(await client.getAll<{ systemuserid: string }>(`systemusers?$select=systemuserid&$filter=_businessunitid_value eq ${b.businessunitid}`)).map((x) => x.systemuserid));
  }
  return new Set(ids.map((i) => i.toLowerCase()));
}

export async function getOrgDefaults(client: DataverseClient): Promise<{ orgId: string; defaults: FormatSettings }> {
  const r = await client.get<{ value: Record<string, unknown>[] }>(`organizations?$select=organizationid,${ORG_KEYS.join(",")}`);
  const o = r.value[0];
  if (!o) throw new Error("Could not read the organization record");
  const defaults: FormatSettings = {};
  for (const k of ORG_KEYS) if (o[k] !== undefined && o[k] !== null) (defaults as Record<string, unknown>)[k] = o[k];
  return { orgId: String(o.organizationid), defaults };
}

function same(a: FormatSettings, b: FormatSettings, keys: (keyof FormatSettings)[]): boolean {
  return keys.every((k) => b[k] === undefined || a[k] === undefined || String(a[k]) === String(b[k]));
}

/** Every setting in the target is already present on the user with the same value. */
function hasTarget(user: FormatSettings, target: FormatSettings): boolean {
  return SETTING_KEYS.every((k) => target[k] === undefined || (user[k] !== undefined && String(user[k]) === String(target[k])));
}

/** Enabled, interactive users in scope with their current settings. */
export async function listUserSettings(client: DataverseClient, scope: UserScope = { kind: "all" }, target?: FormatSettings): Promise<UserRow[]> {
  const [users, settings, org, inScope] = await Promise.all([
    client.getAll<{ systemuserid: string; fullname: string; domainname: string }>("systemusers?$select=systemuserid,fullname,domainname&$filter=isdisabled eq false and accessmode eq 0&$orderby=fullname"),
    client.getAll<Record<string, unknown>>(`usersettingscollection?$select=systemuserid,${SETTING_KEYS.join(",")}`),
    getOrgDefaults(client),
    scopedUserIds(client, scope)
  ]);
  const byUser = new Map(settings.map((s) => [String(s.systemuserid).toLowerCase(), s]));
  return users
    .filter((u) => !inScope || inScope.has(u.systemuserid.toLowerCase()))
    .map((u) => {
      const raw = byUser.get(u.systemuserid.toLowerCase()) ?? {};
      const s: FormatSettings = {};
      for (const k of SETTING_KEYS) if (raw[k] !== undefined && raw[k] !== null) (s as Record<string, unknown>)[k] = raw[k];
      return {
        id: u.systemuserid,
        name: u.fullname,
        login: u.domainname,
        settings: s,
        onDefaults: same(s, org.defaults, ORG_KEYS),
        matches: target ? hasTarget(s, target) : undefined
      };
    });
}

export interface ApplyPlan {
  target: FormatSettings;
  users: UserRow[];
  /** Users that will be changed. */
  toChange: UserRow[];
  skippedPersonalised: number;
  alreadyMatching: number;
}

export function planApply(users: UserRow[], target: FormatSettings, overwrite: boolean): ApplyPlan {
  const toChange = users.filter((u) => !hasTarget(u.settings, target) && (overwrite || u.onDefaults));
  return {
    target,
    users,
    toChange,
    skippedPersonalised: overwrite ? 0 : users.filter((u) => !u.onDefaults && !hasTarget(u.settings, target)).length,
    alreadyMatching: users.filter((u) => hasTarget(u.settings, target)).length
  };
}

export interface ApplyResult {
  changed: number;
  failed: { id: string; name: string; error: string }[];
  orgDefaultsUpdated: boolean;
}

/** Applies settings to the planned users, and optionally makes them the defaults for new users. */
export async function applyUserSettings(
  client: DataverseClient,
  plan: ApplyPlan,
  opts: { setOrgDefaults: boolean; reason?: string; actor?: string; source: "cli" | "dashboard" },
  log = appendAction
): Promise<ApplyResult> {
  checkPolicy(client.env, opts.reason);
  const target = validateSettings(plan.target);
  plan.toChange.forEach((u) => assertGuid(u.id));
  const failed: ApplyResult["failed"] = [];
  await mapLimit(plan.toChange, 4, async (u) => {
    try {
      await client.update("usersettingscollection", u.id, target as Record<string, unknown>);
    } catch (e) {
      failed.push({ id: u.id, name: u.name, error: (e as Error).message });
    }
  });
  let orgDefaultsUpdated = false;
  if (opts.setOrgDefaults) {
    const { orgId } = await getOrgDefaults(client);
    const body: Record<string, unknown> = {};
    for (const k of ORG_KEYS) if (target[k] !== undefined) body[k] = target[k];
    try {
      await client.update("organizations", orgId, body);
      orgDefaultsUpdated = true;
    } catch (e) {
      failed.push({ id: orgId, name: "Organization defaults", error: (e as Error).message });
    }
  }
  log({
    at: new Date().toISOString(),
    env: client.env.name,
    action: "user settings",
    kind: "usersettings",
    id: "",
    name: `${plan.toChange.length - failed.filter((f) => f.name !== "Organization defaults").length} users${orgDefaultsUpdated ? " + defaults for new users" : ""}: ${JSON.stringify(target)}`,
    reason: opts.reason?.trim() || undefined,
    actor: opts.actor,
    source: opts.source,
    ok: failed.length === 0,
    error: failed.length ? `${failed.length} failed` : undefined
  });
  return { changed: plan.toChange.length - failed.filter((f) => f.name !== "Organization defaults").length, failed, orgDefaultsUpdated };
}
