import type { EnvConfig } from "./config.js";
import { assertGuid, type DataverseClient } from "./dataverse.js";
import { appendAction } from "./actionLog.js";
import { isMicrosoftPublisher } from "./solutions.js";
import { requireAccess } from "./access.js";

export type ComponentKind = "flow" | "rule" | "plugin";

export interface ComponentItem {
  id: string;
  kind: ComponentKind;
  name: string;
  on: boolean;
  /** Table (or message and table for plugin steps). */
  target: string;
  modifiedOn?: string;
  /** Built by your organisation, not shipped by Microsoft or the platform. */
  custom: boolean;
  /** Name of the solution that owns it (the managed solution, or "Active" for unmanaged). */
  solution?: string;
  managed?: boolean;
}

interface RawWorkflow {
  workflowid: string;
  name: string;
  statecode: number;
  primaryentity?: string;
  modifiedon?: string;
  ismanaged?: boolean;
  solutionid?: string;
}

interface RawStep {
  sdkmessageprocessingstepid: string;
  name: string;
  statecode: number;
  stage: number;
  mode: number;
  modifiedon?: string;
  ismanaged?: boolean;
  solutionid?: string;
  customizationlevel?: number;
  sdkmessageid?: { name?: string } | null;
  sdkmessagefilterid?: { primaryobjecttypecode?: string } | null;
}

// workflow.category: 5 = modern (cloud) flow, 2 = business rule. type 1 = the definition row.
const WORKFLOW_CATEGORY: Record<"flow" | "rule", number> = { flow: 5, rule: 2 };
const STAGE: Record<number, string> = { 10: "Pre-validation", 20: "Pre-operation", 40: "Post-operation" };

interface OwnerInfo {
  name: string;
  microsoft: boolean;
}

/** Which solutions belong to Microsoft or the platform, keyed by solution ID. */
async function solutionOwners(client: DataverseClient): Promise<Map<string, OwnerInfo>> {
  const m = new Map<string, OwnerInfo>();
  try {
    const rows = await client.getAll<{ solutionid: string; friendlyname: string; uniquename: string; publisherid?: { uniquename?: string; friendlyname?: string; customizationprefix?: string } | null }>(
      "solutions?$select=solutionid,friendlyname,uniquename&$expand=publisherid($select=uniquename,friendlyname,customizationprefix)"
    );
    for (const r of rows) {
      const pub = { uniqueName: r.publisherid?.uniquename ?? "", friendlyName: r.publisherid?.friendlyname ?? "", prefix: r.publisherid?.customizationprefix ?? "" };
      // "System" and "Active" are platform solutions; Active holds unmanaged (your own) work.
      const system = r.uniquename === "System" || /^microsoft/i.test(pub.uniqueName) || isMicrosoftPublisher(pub);
      m.set(r.solutionid.toLowerCase(), { name: r.friendlyname, microsoft: system && r.uniquename !== "Active" && r.uniquename !== "Default" });
    }
  } catch {
    /* without the map everything counts as custom */
  }
  return m;
}

export interface ListOptions {
  /** Include items shipped by Microsoft or the platform. Default: custom only. */
  includeSystem?: boolean;
}

export async function listComponents(client: DataverseClient, kind: ComponentKind, opts: ListOptions = {}): Promise<ComponentItem[]> {
  const owners = await solutionOwners(client);
  const owner = (id?: string) => (id ? owners.get(id.toLowerCase()) : undefined);
  let items: ComponentItem[];
  if (kind === "plugin") {
    // Hidden steps are platform internals and never shown. customizationlevel 0 = system step.
    const levelFilter = opts.includeSystem ? "" : "customizationlevel eq 1 and ";
    const rows = await client.getAll<RawStep>(
      "sdkmessageprocessingsteps?$select=sdkmessageprocessingstepid,name,statecode,stage,mode,modifiedon,ismanaged,solutionid,customizationlevel" +
        "&$expand=sdkmessageid($select=name),sdkmessagefilterid($select=primaryobjecttypecode)" +
        `&$filter=${levelFilter}ishidden/Value eq false&$orderby=name`
    );
    items = rows.map((r) => {
      const o = owner(r.solutionid);
      return {
        id: r.sdkmessageprocessingstepid,
        kind,
        name: r.name,
        on: r.statecode === 0,
        target: [r.sdkmessagefilterid?.primaryobjecttypecode || "any", r.sdkmessageid?.name ?? "", STAGE[r.stage] ?? `stage ${r.stage}`, r.mode === 1 ? "async" : "sync"]
          .filter(Boolean)
          .join(" · "),
        modifiedOn: r.modifiedon,
        custom: r.customizationlevel !== 0 && !o?.microsoft,
        solution: o?.name,
        managed: r.ismanaged
      };
    });
  } else {
    const rows = await client.getAll<RawWorkflow>(
      `workflows?$select=workflowid,name,statecode,primaryentity,modifiedon,ismanaged,solutionid&$filter=category eq ${WORKFLOW_CATEGORY[kind]} and type eq 1&$orderby=name`
    );
    items = rows.map((r) => {
      const o = owner(r.solutionid);
      return {
        id: r.workflowid,
        kind,
        name: r.name,
        on: r.statecode === 1,
        target: r.primaryentity && r.primaryentity !== "none" ? r.primaryentity : "—",
        modifiedOn: r.modifiedon,
        custom: !o?.microsoft,
        solution: o?.name,
        managed: r.ismanaged
      };
    });
  }
  return opts.includeSystem ? items : items.filter((i) => i.custom);
}

/** The state/status pair that turns a component on or off. */
export function statePatch(kind: ComponentKind, on: boolean): { entitySet: string; body: { statecode: number; statuscode: number } } {
  if (kind === "plugin") return { entitySet: "sdkmessageprocessingsteps", body: on ? { statecode: 0, statuscode: 1 } : { statecode: 1, statuscode: 2 } };
  return { entitySet: "workflows", body: on ? { statecode: 1, statuscode: 2 } : { statecode: 0, statuscode: 1 } };
}

import { PolicyError } from "./errors.js";
export { PolicyError };

export interface ChangeRequest {
  kind: ComponentKind;
  items: { id: string; name: string }[];
  on: boolean;
  reason?: string;
  actor?: string;
  source: "cli" | "dashboard";
}

export interface ChangeResult {
  id: string;
  name: string;
  ok: boolean;
  error?: string;
}

/** Managed environments (everything after DEV) need a reason for every change. */
export function checkPolicy(env: EnvConfig, reason?: string): void {
  if (env.managed && !(reason && reason.trim().length >= 3)) {
    throw new PolicyError(`${env.name} is a managed environment: give a reason (at least 3 characters) for this change.`);
  }
}

export async function changeState(client: DataverseClient, req: ChangeRequest, log = appendAction): Promise<ChangeResult[]> {
  checkPolicy(client.env, req.reason);
  await requireAccess(client, "customize", `turn ${req.kind === "plugin" ? "plugin steps" : req.kind === "rule" ? "business rules" : "flows"} on or off`);
  req.items.forEach((i) => assertGuid(i.id));
  const { entitySet, body } = statePatch(req.kind, req.on);
  const results: ChangeResult[] = [];
  for (const item of req.items) {
    try {
      await client.update(entitySet, item.id, body);
      results.push({ id: item.id, name: item.name, ok: true });
    } catch (e) {
      results.push({ id: item.id, name: item.name, ok: false, error: (e as Error).message });
    }
    const last = results[results.length - 1]!;
    log({
      at: new Date().toISOString(),
      env: client.env.name,
      action: req.on ? "turn-on" : "turn-off",
      kind: req.kind,
      id: item.id,
      name: item.name,
      reason: req.reason?.trim() || undefined,
      actor: req.actor,
      source: req.source,
      ok: last.ok,
      error: last.error
    });
  }
  return results;
}

/** Picks components by exact name or ID, or by a substring filter, or all of them. */
export function selectComponents(all: ComponentItem[], sel: { names?: string[]; filter?: string; all?: boolean }): ComponentItem[] {
  if (sel.all) return all;
  const out = new Map<string, ComponentItem>();
  const f = sel.filter?.toLowerCase();
  if (f) for (const c of all) if (c.name.toLowerCase().includes(f)) out.set(c.id, c);
  for (const n of sel.names ?? []) {
    const k = n.toLowerCase();
    const hits = all.filter((c) => c.id.toLowerCase() === k || c.name.toLowerCase() === k);
    if (hits.length === 0) throw new Error(`No component named "${n}"`);
    hits.forEach((h) => out.set(h.id, h));
  }
  return [...out.values()];
}
