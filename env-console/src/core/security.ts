import type { DataverseClient } from "./dataverse.js";
import { assertGuid } from "./dataverse.js";

export interface UserRoles {
  login: string;
  name: string;
  businessUnit?: string;
  /** Role names assigned directly to the user (roles through teams are listed separately). */
  roles: string[];
  teamRoles: string[];
}

interface RawUser {
  systemuserid: string;
  fullname: string;
  domainname: string;
  "_businessunitid_value@OData.Community.Display.V1.FormattedValue"?: string;
  systemuserroles_association?: { name: string }[];
  teammembership_association?: { name: string; teamroles_association?: { name: string }[] }[];
}

/** Enabled interactive users with their roles (direct and through teams). Users are matched across environments by login. */
export async function listUserRoles(client: DataverseClient): Promise<UserRoles[]> {
  const rows = await client.getAll<RawUser>(
    "systemusers?$select=systemuserid,fullname,domainname,_businessunitid_value" +
      "&$expand=systemuserroles_association($select=name),teammembership_association($select=name;$expand=teamroles_association($select=name))" +
      "&$filter=isdisabled eq false and accessmode eq 0&$orderby=fullname"
  ).catch(async () =>
    // Some environments refuse the nested expand; fall back to direct roles only.
    client.getAll<RawUser>("systemusers?$select=systemuserid,fullname,domainname,_businessunitid_value&$expand=systemuserroles_association($select=name)&$filter=isdisabled eq false and accessmode eq 0&$orderby=fullname")
  );
  return rows
    .filter((u) => u.domainname)
    .map((u) => ({
      login: u.domainname.toLowerCase(),
      name: u.fullname,
      businessUnit: u["_businessunitid_value@OData.Community.Display.V1.FormattedValue"],
      roles: [...new Set((u.systemuserroles_association ?? []).map((r) => r.name))].sort(),
      teamRoles: [...new Set((u.teammembership_association ?? []).flatMap((t) => (t.teamroles_association ?? []).map((r) => r.name)))].sort()
    }));
}

export interface RoleInfo {
  id: string;
  name: string;
  managed: boolean;
  /** Number of users holding it directly. */
  users: number;
}

/** Roles in the root business unit (each role is copied into every business unit; the root copy is the definition). */
export async function listRoles(client: DataverseClient): Promise<RoleInfo[]> {
  const rows = await client.getAll<{ roleid: string; name: string; ismanaged: boolean; systemuserroles_association?: { systemuserid: string }[] }>(
    "roles?$select=roleid,name,ismanaged&$filter=_parentroleid_value eq null&$expand=systemuserroles_association($select=systemuserid)&$orderby=name"
  );
  return rows.map((r) => ({ id: r.roleid, name: r.name, managed: r.ismanaged, users: (r.systemuserroles_association ?? []).length }));
}

export interface PrivilegeEntry {
  name: string;
  depth: string;
}

const DEPTH: Record<string, string> = { Basic: "User", Local: "Business unit", Deep: "Parent: child BUs", Global: "Organization", "0": "User", "1": "Business unit", "2": "Parent: child BUs", "3": "Organization" };

/** The privileges a role grants, with their access level. */
export async function rolePrivileges(client: DataverseClient, roleId: string): Promise<PrivilegeEntry[]> {
  assertGuid(roleId);
  const r = await client.get<{ RolePrivileges: { PrivilegeName?: string; PrivilegeId: string; Depth: string | number }[] }>(`RetrieveRolePrivilegesRole(RoleId=${roleId})`);
  let names = new Map<string, string>();
  if (r.RolePrivileges.some((p) => !p.PrivilegeName)) {
    const all = await client.getAll<{ privilegeid: string; name: string }>("privileges?$select=privilegeid,name");
    names = new Map(all.map((p) => [p.privilegeid.toLowerCase(), p.name]));
  }
  return r.RolePrivileges.map((p) => ({ name: p.PrivilegeName ?? names.get(p.PrivilegeId.toLowerCase()) ?? p.PrivilegeId, depth: DEPTH[String(p.Depth)] ?? String(p.Depth) })).sort((a, b) => a.name.localeCompare(b.name));
}
