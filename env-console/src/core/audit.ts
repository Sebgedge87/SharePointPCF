import { appendAction } from "./actionLog.js";
import { checkPolicy } from "./components.js";
import type { DataverseClient } from "./dataverse.js";
import { fv, label, mapLimit } from "./util.js";

export interface SystemAudit {
  orgId: string;
  auditEnabled: boolean;
  userAccessAudit: boolean;
  readAudit?: boolean;
  /** Days kept; -1 = forever. */
  retentionDays?: number;
}

export async function getSystemAudit(client: DataverseClient): Promise<SystemAudit> {
  const r = await client.get<{ value: Record<string, unknown>[] }>("organizations?$select=organizationid,isauditenabled,isuseraccessauditenabled,isreadauditenabled,auditretentionperiodv2");
  const o = r.value[0];
  if (!o) throw new Error("Could not read the organization record");
  return {
    orgId: String(o.organizationid),
    auditEnabled: o.isauditenabled === true,
    userAccessAudit: o.isuseraccessauditenabled === true,
    readAudit: typeof o.isreadauditenabled === "boolean" ? o.isreadauditenabled : undefined,
    retentionDays: typeof o.auditretentionperiodv2 === "number" ? o.auditretentionperiodv2 : undefined
  };
}

export interface TableAudit {
  logicalName: string;
  displayName: string;
  metadataId: string;
  auditEnabled: boolean;
  canChange: boolean;
  isCustom: boolean;
}

interface BoolProp {
  Value: boolean;
  CanBeChanged?: boolean;
}

export async function listTableAudit(client: DataverseClient): Promise<TableAudit[]> {
  const r = await client.get<{ value: Record<string, unknown>[] }>("EntityDefinitions?$select=LogicalName,DisplayName,MetadataId,IsAuditEnabled,IsCustomEntity,IsIntersect,IsPrivate");
  return r.value
    .filter((e) => !e.IsIntersect && !e.IsPrivate)
    .map((e) => {
      const a = e.IsAuditEnabled as BoolProp | undefined;
      return {
        logicalName: String(e.LogicalName),
        displayName: label(e.DisplayName) || String(e.LogicalName),
        metadataId: String(e.MetadataId),
        auditEnabled: !!a?.Value,
        canChange: a?.CanBeChanged !== false,
        isCustom: e.IsCustomEntity === true
      };
    })
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

export interface ColumnAudit {
  logicalName: string;
  displayName: string;
  metadataId: string;
  type: string;
  auditEnabled: boolean;
  canChange: boolean;
}

const LOGICAL = /^[a-z0-9_]{1,128}$/;
function assertLogical(n: string): void {
  if (!LOGICAL.test(n)) throw new Error(`Not a valid logical name: ${n}`);
}

export async function listColumnAudit(client: DataverseClient, table: string): Promise<ColumnAudit[]> {
  assertLogical(table);
  const r = await client.get<{ value: Record<string, unknown>[] }>(
    `EntityDefinitions(LogicalName='${table}')/Attributes?$select=LogicalName,DisplayName,MetadataId,IsAuditEnabled,AttributeType,AttributeOf,IsValidForUpdate,IsValidForCreate`
  );
  return r.value
    .filter((c) => !c.AttributeOf && (c.IsValidForUpdate !== false || c.IsValidForCreate !== false))
    .map((c) => {
      const a = c.IsAuditEnabled as BoolProp | undefined;
      return {
        logicalName: String(c.LogicalName),
        displayName: label(c.DisplayName) || String(c.LogicalName),
        metadataId: String(c.MetadataId),
        type: String(c.AttributeType ?? ""),
        auditEnabled: !!a?.Value,
        canChange: a?.CanBeChanged !== false
      };
    })
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

/** Metadata updates are full PUTs; strip OData bookkeeping and keep the derived type. */
function forPut(def: Record<string, unknown>, on: boolean): Record<string, unknown> {
  const copy: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(def)) if (!k.startsWith("@odata.") || k === "@odata.type") copy[k] = v;
  copy.IsAuditEnabled = { ...((def.IsAuditEnabled as object) ?? {}), Value: on };
  return copy;
}

async function publish(client: DataverseClient, tables: string[]): Promise<void> {
  const xml = `<importexportxml><entities>${tables.map((t) => `<entity>${t}</entity>`).join("")}</entities></importexportxml>`;
  await client.request("POST", "PublishXml", { ParameterXml: xml });
}

export interface AuditChange {
  table: string;
  /** Omit to change the table itself. */
  column?: string;
  on: boolean;
}

export interface AuditChangeResult extends AuditChange {
  ok: boolean;
  error?: string;
}

/**
 * Turns auditing on or off for tables and columns (in bulk), then publishes the changed tables.
 * Managed environments need a reason. Every change is logged.
 */
export async function setAudit(client: DataverseClient, changes: AuditChange[], reason: string | undefined, actor: string | undefined, source: "cli" | "dashboard", log = appendAction): Promise<AuditChangeResult[]> {
  checkPolicy(client.env, reason);
  changes.forEach((c) => {
    assertLogical(c.table);
    if (c.column) assertLogical(c.column);
  });
  const results = await mapLimit(changes, 3, async (c): Promise<AuditChangeResult> => {
    try {
      const path = c.column ? `EntityDefinitions(LogicalName='${c.table}')/Attributes(LogicalName='${c.column}')` : `EntityDefinitions(LogicalName='${c.table}')`;
      const def = await client.get<Record<string, unknown>>(path);
      await client.request("PUT", path, forPut(def, c.on), { "MSCRM.MergeLabels": "true" });
      return { ...c, ok: true };
    } catch (e) {
      return { ...c, ok: false, error: (e as Error).message };
    }
  });
  const changed = [...new Set(results.filter((r) => r.ok).map((r) => r.table))];
  if (changed.length) {
    try {
      await publish(client, changed);
    } catch (e) {
      results.forEach((r) => {
        if (r.ok) {
          r.ok = false;
          r.error = `Saved but not published: ${(e as Error).message}`;
        }
      });
    }
  }
  for (const r of results) {
    log({
      at: new Date().toISOString(),
      env: client.env.name,
      action: `audit ${r.on ? "on" : "off"}`,
      kind: r.column ? "column" : "table",
      id: r.column ? `${r.table}.${r.column}` : r.table,
      name: r.column ? `${r.table}.${r.column}` : r.table,
      reason: reason?.trim() || undefined,
      actor,
      source,
      ok: r.ok,
      error: r.error
    });
  }
  return results;
}

export async function setSystemAudit(client: DataverseClient, change: { auditEnabled?: boolean; userAccessAudit?: boolean }, reason: string | undefined, actor: string | undefined, source: "cli" | "dashboard", log = appendAction): Promise<void> {
  checkPolicy(client.env, reason);
  const sys = await getSystemAudit(client);
  const body: Record<string, unknown> = {};
  if (change.auditEnabled !== undefined) body.isauditenabled = change.auditEnabled;
  if (change.userAccessAudit !== undefined) body.isuseraccessauditenabled = change.userAccessAudit;
  let ok = true;
  let error: string | undefined;
  try {
    await client.update("organizations", sys.orgId, body);
  } catch (e) {
    ok = false;
    error = (e as Error).message;
  }
  log({ at: new Date().toISOString(), env: client.env.name, action: `system audit ${JSON.stringify(change)}`, kind: "setting", id: sys.orgId, name: "System auditing", reason, actor, source, ok, error });
  if (!ok) throw new Error(error);
}

export interface AuditEntry {
  id: string;
  at: string;
  action: string;
  operation: string;
  user: string;
  record: string;
  recordId?: string;
  changes: { column: string; old: string; new: string }[];
}

interface ChangeData {
  changedAttributes?: { logicalName: string; oldValue?: unknown; newValue?: unknown }[];
}

/** Audit history for a table (optionally one column), newest first. */
export async function listAuditEntries(client: DataverseClient, table: string, since: Date, opts: { column?: string; max?: number } = {}): Promise<AuditEntry[]> {
  assertLogical(table);
  if (opts.column) assertLogical(opts.column);
  const rows = await client.getAll<Record<string, unknown>>(
    `audits?$select=auditid,createdon,action,operation,objecttypecode,_objectid_value,_userid_value,changedata&$filter=objecttypecode eq '${table}' and createdon ge ${since.toISOString()}&$orderby=createdon desc`,
    opts.max ?? 500
  );
  const out = rows.map((r) => {
    let changes: AuditEntry["changes"] = [];
    try {
      const cd = JSON.parse(String(r.changedata ?? "")) as ChangeData;
      changes = (cd.changedAttributes ?? []).map((c) => ({ column: c.logicalName, old: c.oldValue == null ? "" : String(c.oldValue), new: c.newValue == null ? "" : String(c.newValue) }));
    } catch {
      /* older format or no change data */
    }
    return {
      id: String(r.auditid),
      at: String(r.createdon),
      action: fv(r, "action") ?? String(r.action ?? ""),
      operation: fv(r, "operation") ?? String(r.operation ?? ""),
      user: fv(r, "_userid_value") ?? String(r._userid_value ?? ""),
      record: fv(r, "_objectid_value") ?? String(r._objectid_value ?? ""),
      recordId: r._objectid_value ? String(r._objectid_value) : undefined,
      changes
    };
  });
  if (!opts.column) return out;
  return out
    .map((e) => ({ ...e, changes: e.changes.filter((c) => c.column === opts.column) }))
    .filter((e) => e.changes.length > 0);
}
