import type { DataverseClient } from "./dataverse.js";
import { PolicyError } from "./errors.js";

/**
 * Role checks before any change. Dataverse enforces privileges itself; this check runs first so
 * people only change what their role is meant for, and get a clear message when they can't.
 */

/** Template IDs of the built-in roles. They are the same in every environment and language. */
export const ROLE_TEMPLATES = {
  systemAdministrator: "627090ff-40a3-4053-8790-584edc5be201",
  systemCustomizer: "119f245c-3cc8-4b62-b31c-d1a046ced15d"
} as const;

/** What a change needs: "customize" = System Administrator or System Customizer; "admin" = System Administrator. */
export type Permission = "customize" | "admin";

export const PERMISSION_LABEL: Record<Permission, string> = {
  customize: "System Administrator or System Customizer",
  admin: "System Administrator"
};

export interface Access {
  userId: string;
  user: string;
  /** Role names, direct and through teams. */
  roles: string[];
  isAdmin: boolean;
  isCustomizer: boolean;
  can: Record<Permission, boolean>;
}

/** Extra role names (from the config) that also grant each permission. */
export type ExtraRoles = { customize?: string[]; admin?: string[] };

export class AccessError extends PolicyError {}

interface RawRole {
  name: string;
  _roletemplateid_value?: string | null;
}
interface RawUser {
  fullname?: string;
  domainname?: string;
  systemuserroles_association?: RawRole[];
  teammembership_association?: { teamroles_association?: RawRole[] }[];
}

const TTL = 5 * 60_000;
const cache = new WeakMap<DataverseClient, { at: number; value: Promise<Access> }>();

export function accessFrom(userId: string, user: RawUser, extra: ExtraRoles = {}): Access {
  const all: RawRole[] = [...(user.systemuserroles_association ?? []), ...(user.teammembership_association ?? []).flatMap((t) => t.teamroles_association ?? [])];
  const templates = new Set(all.map((r) => (r._roletemplateid_value ?? "").toLowerCase()));
  const names = [...new Set(all.map((r) => r.name))].sort();
  const lower = new Set(names.map((n) => n.toLowerCase()));
  const has = (list?: string[]) => (list ?? []).some((n) => lower.has(n.toLowerCase()));
  const isAdmin = templates.has(ROLE_TEMPLATES.systemAdministrator);
  const isCustomizer = templates.has(ROLE_TEMPLATES.systemCustomizer);
  const admin = isAdmin || has(extra.admin);
  return {
    userId,
    user: user.domainname || user.fullname || userId,
    roles: names,
    isAdmin,
    isCustomizer,
    can: { admin, customize: admin || isCustomizer || has(extra.customize) }
  };
}

/** The signed-in user's roles in this environment (cached for five minutes). */
export function getAccess(client: DataverseClient, extra: ExtraRoles = {}, now = Date.now()): Promise<Access> {
  const hit = cache.get(client);
  if (hit && now - hit.at < TTL) return hit.value;
  const value = (async () => {
    const w = await client.get<{ UserId: string }>("WhoAmI");
    const role = "$select=name,_roletemplateid_value";
    const base = `systemusers(${w.UserId})?$select=fullname,domainname&$expand=systemuserroles_association(${role})`;
    const user = await client
      .get<RawUser>(`${base},teammembership_association($select=teamid;$expand=teamroles_association(${role}))`)
      // Some environments refuse the nested expand; fall back to direct roles only.
      .catch(() => client.get<RawUser>(base));
    return accessFrom(w.UserId, user, extra);
  })();
  cache.set(client, { at: now, value });
  value.catch(() => cache.delete(client));
  return value;
}

export function clearAccessCache(client: DataverseClient): void {
  cache.delete(client);
}

/** Extra role names configured for this client's workspace, if any. */
const extras = new WeakMap<DataverseClient, ExtraRoles>();
export function setExtraRoles(client: DataverseClient, extra: ExtraRoles | undefined): void {
  if (extra) extras.set(client, extra);
}

/** Throws AccessError unless the signed-in user may make this kind of change here. */
export async function requireAccess(client: DataverseClient, permission: Permission, what: string): Promise<Access> {
  let a: Access;
  try {
    a = await getAccess(client, extras.get(client));
  } catch (e) {
    throw new AccessError(`Could not check your security roles in ${client.env.label || client.env.name}, so nothing was changed: ${(e as Error).message}`);
  }
  if (!a.can[permission]) {
    const yours = a.roles.length ? a.roles.join(", ") : "none";
    throw new AccessError(`You need the ${PERMISSION_LABEL[permission]} role in ${client.env.label || client.env.name} to ${what}. Your roles there: ${yours}.`);
  }
  return a;
}
