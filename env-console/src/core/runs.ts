import type { EnvConfig } from "./config.js";
import type { DataverseClient } from "./dataverse.js";
import { appendAction } from "./actionLog.js";
import { checkPolicy } from "./components.js";
import { fv } from "./util.js";
import { requireAccess } from "./access.js";

export type RunStatus = "succeeded" | "failed" | "cancelled" | "running" | "other";

export interface FlowRun {
  id: string;
  flowId?: string;
  flowName: string;
  status: RunStatus;
  start: string;
  end?: string;
  durationMs?: number;
  trigger?: string;
  errorCode?: string;
  errorMessage?: string;
  /** Link to the run in Power Automate, when it can be worked out. */
  link?: string;
}

export interface PluginLog {
  id: string;
  typeName: string;
  message: string;
  table?: string;
  at: string;
  durationMs?: number;
  depth?: number;
  mode: "sync" | "async";
  failed: boolean;
  exception?: string;
  trace?: string;
  correlationId?: string;
}

/** organization.plugintracelogsetting */
export type TraceSetting = "off" | "exceptions" | "all";
const TRACE_CODES: Record<TraceSetting, number> = { off: 0, exceptions: 1, all: 2 };

export function runStatus(raw: unknown): RunStatus {
  const s = String(raw ?? "").toLowerCase();
  if (s.includes("fail") || s.includes("fault") || s.includes("timedout")) return "failed";
  if (s.includes("succe")) return "succeeded";
  if (s.includes("cancel") || s.includes("abort") || s.includes("skip")) return "cancelled";
  if (s.includes("run") || s.includes("wait")) return "running";
  return "other";
}

async function environmentId(client: DataverseClient): Promise<string | undefined> {
  try {
    const r = await client.get<{ Detail?: { EnvironmentId?: string } }>(
      "RetrieveCurrentOrganization(AccessType=@p)?@p=Microsoft.Dynamics.CRM.EndpointAccessType'Default'"
    );
    return r.Detail?.EnvironmentId;
  } catch {
    return undefined;
  }
}

/**
 * Cloud flow runs from Dataverse's flow run history (the flowrun table).
 * Returns available=false when the environment does not keep run history in Dataverse.
 */
export async function listFlowRuns(client: DataverseClient, since: Date, opts: { failedOnly?: boolean; max?: number } = {}): Promise<{ available: boolean; error?: string; runs: FlowRun[] }> {
  const filter = `starttime ge ${since.toISOString()}`;
  const base = `flowruns?$filter=${filter}&$orderby=starttime desc`;
  let rows: Record<string, unknown>[];
  try {
    rows = await client.getAll<Record<string, unknown>>(
      `flowruns?$select=flowrunid,name,status,starttime,endtime,duration,errorcode,errormessage,triggertype,_workflow_value&$filter=${filter}&$orderby=starttime desc`,
      opts.max ?? 2000
    );
  } catch {
    try {
      rows = await client.getAll<Record<string, unknown>>(base, opts.max ?? 2000);
    } catch (e) {
      return { available: false, error: `Flow run history is not available here: ${(e as Error).message}`, runs: [] };
    }
  }
  // Names and Power Automate IDs for the flows, so runs can be labelled and linked.
  const flows = new Map<string, { name: string; resourceId?: string }>();
  try {
    const wf = await client.getAll<{ workflowid: string; name: string; resourceid?: string }>("workflows?$select=workflowid,name,resourceid&$filter=category eq 5 and type eq 1");
    wf.forEach((w) => flows.set(w.workflowid.toLowerCase(), { name: w.name, resourceId: w.resourceid }));
  } catch {
    /* names fall back to the run's own label */
  }
  const envId = await environmentId(client);
  const runs = rows.map((r) => {
    const flowId = String(r._workflow_value ?? r.workflowid ?? "").toLowerCase() || undefined;
    const flow = flowId ? flows.get(flowId) : undefined;
    const name = String(r.name ?? r.flowrunid ?? "");
    const duration = Number(r.duration);
    const run: FlowRun = {
      id: String(r.flowrunid ?? name),
      flowId,
      flowName: flow?.name ?? fv(r, "_workflow_value") ?? "Unknown flow",
      status: runStatus(fv(r, "status") ?? r.status),
      start: String(r.starttime ?? r.createdon ?? ""),
      end: r.endtime ? String(r.endtime) : undefined,
      durationMs: Number.isFinite(duration) ? duration : undefined,
      trigger: r.triggertype ? String(fv(r, "triggertype") ?? r.triggertype) : undefined,
      errorCode: r.errorcode ? String(r.errorcode) : undefined,
      errorMessage: r.errormessage ? String(r.errormessage) : undefined
    };
    if (envId && flow?.resourceId && name) run.link = `https://make.powerautomate.com/environments/${envId}/flows/${flow.resourceId}/runs/${encodeURIComponent(name)}`;
    return run;
  });
  return { available: true, runs: opts.failedOnly ? runs.filter((r) => r.status === "failed") : runs };
}

export async function getTraceSetting(client: DataverseClient): Promise<{ orgId: string; setting: TraceSetting }> {
  const r = await client.get<{ value: { organizationid: string; plugintracelogsetting: number }[] }>("organizations?$select=organizationid,plugintracelogsetting");
  const org = r.value[0];
  if (!org) throw new Error("Could not read the organization record");
  const setting = (Object.keys(TRACE_CODES) as TraceSetting[]).find((k) => TRACE_CODES[k] === org.plugintracelogsetting) ?? "off";
  return { orgId: org.organizationid, setting };
}

export async function setTraceSetting(client: DataverseClient, setting: TraceSetting, reason: string | undefined, actor: string | undefined, source: "cli" | "dashboard", log = appendAction): Promise<void> {
  checkPolicy(client.env, reason);
  await requireAccess(client, "admin", "change the plugin trace log setting");
  const { orgId, setting: before } = await getTraceSetting(client);
  let ok = true;
  let error: string | undefined;
  try {
    await client.update("organizations", orgId, { plugintracelogsetting: TRACE_CODES[setting] });
  } catch (e) {
    ok = false;
    error = (e as Error).message;
  }
  log({ at: new Date().toISOString(), env: client.env.name, action: `trace-log ${before} → ${setting}`, kind: "setting", id: orgId, name: "Plugin trace log", reason, actor, source, ok, error });
  if (!ok) throw new Error(error);
}

/** Plugin trace log rows. Exceptions are recorded when tracing is "exceptions" or "all"; successes only with "all". */
export async function listPluginLogs(client: DataverseClient, since: Date, opts: { failedOnly?: boolean; max?: number } = {}): Promise<PluginLog[]> {
  let filter = `createdon ge ${since.toISOString()}`;
  if (opts.failedOnly) filter += " and exceptiondetails ne null";
  const rows = await client.getAll<Record<string, unknown>>(
    `plugintracelogs?$select=plugintracelogid,typename,messagename,primaryentity,exceptiondetails,messageblock,createdon,performanceexecutionduration,depth,mode,correlationid&$filter=${filter}&$orderby=createdon desc`,
    opts.max ?? 1000
  );
  return rows.map((r) => {
    const ex = r.exceptiondetails ? String(r.exceptiondetails) : "";
    const d = Number(r.performanceexecutionduration);
    return {
      id: String(r.plugintracelogid),
      typeName: String(r.typename ?? ""),
      message: String(r.messagename ?? ""),
      table: r.primaryentity ? String(r.primaryentity) : undefined,
      at: String(r.createdon ?? ""),
      durationMs: Number.isFinite(d) ? d : undefined,
      depth: r.depth !== undefined ? Number(r.depth) : undefined,
      mode: Number(r.mode) === 1 ? "async" : "sync",
      failed: ex.trim().length > 0,
      exception: ex || undefined,
      trace: r.messageblock ? String(r.messageblock) : undefined,
      correlationId: r.correlationid ? String(r.correlationid) : undefined
    };
  });
}

export interface DayPoint {
  day: string;
  flowSucceeded: number;
  flowFailed: number;
  flowOther: number;
  pluginFailed: number;
  pluginSucceeded: number;
}

/** Runs per day (UTC), oldest first, with every day in the range present. */
export function dailySeries(flows: FlowRun[], plugins: PluginLog[], since: Date, now = new Date()): DayPoint[] {
  const days: DayPoint[] = [];
  const index = new Map<string, DayPoint>();
  const start = new Date(Date.UTC(since.getUTCFullYear(), since.getUTCMonth(), since.getUTCDate()));
  for (let d = start; d <= now; d = new Date(d.getTime() + 86_400_000)) {
    const p = { day: d.toISOString().slice(0, 10), flowSucceeded: 0, flowFailed: 0, flowOther: 0, pluginFailed: 0, pluginSucceeded: 0 };
    days.push(p);
    index.set(p.day, p);
  }
  for (const f of flows) {
    const p = index.get(f.start.slice(0, 10));
    if (!p) continue;
    if (f.status === "succeeded") p.flowSucceeded++;
    else if (f.status === "failed") p.flowFailed++;
    else p.flowOther++;
  }
  for (const l of plugins) {
    const p = index.get(l.at.slice(0, 10));
    if (!p) continue;
    if (l.failed) p.pluginFailed++;
    else p.pluginSucceeded++;
  }
  return days;
}

export interface FailureGroup {
  kind: "flow" | "plugin";
  name: string;
  failures: number;
  total: number;
  lastError?: string;
  lastAt?: string;
}

/** Components ranked by number of failures. */
export function topFailures(flows: FlowRun[], plugins: PluginLog[]): FailureGroup[] {
  const m = new Map<string, FailureGroup>();
  const add = (kind: "flow" | "plugin", name: string, failed: boolean, err: string | undefined, at: string) => {
    const k = `${kind}:${name}`;
    const g = m.get(k) ?? { kind, name, failures: 0, total: 0 };
    g.total++;
    if (failed) {
      g.failures++;
      if (!g.lastAt || at > g.lastAt) {
        g.lastAt = at;
        g.lastError = err;
      }
    }
    m.set(k, g);
  };
  flows.forEach((f) => add("flow", f.flowName, f.status === "failed", f.errorMessage ?? f.errorCode, f.start));
  plugins.forEach((l) => add("plugin", l.typeName, l.failed, l.exception?.split("\n")[0], l.at));
  return [...m.values()].filter((g) => g.failures > 0).sort((a, b) => b.failures - a.failures || a.name.localeCompare(b.name));
}

export interface RunReport {
  env: string;
  since: string;
  flows: { available: boolean; error?: string; runs: FlowRun[] };
  plugins: { setting?: TraceSetting; error?: string; logs: PluginLog[] };
  daily: DayPoint[];
  top: FailureGroup[];
  totals: { flowRuns: number; flowFailed: number; pluginLogged: number; pluginFailed: number };
}

export async function runReport(client: DataverseClient, env: EnvConfig, since: Date): Promise<RunReport> {
  const [flows, trace, plugins] = await Promise.all([
    listFlowRuns(client, since),
    getTraceSetting(client).catch((e: Error) => ({ error: e.message })),
    listPluginLogs(client, since).then(
      (logs) => ({ logs }),
      (e: Error) => ({ logs: [] as PluginLog[], error: e.message })
    )
  ]);
  const pluginInfo: RunReport["plugins"] = { logs: plugins.logs };
  if ("setting" in trace) pluginInfo.setting = trace.setting;
  if ("error" in plugins && plugins.error) pluginInfo.error = plugins.error;
  return {
    env: env.name,
    since: since.toISOString(),
    flows,
    plugins: pluginInfo,
    daily: dailySeries(flows.runs, plugins.logs, since),
    top: topFailures(flows.runs, plugins.logs),
    totals: {
      flowRuns: flows.runs.length,
      flowFailed: flows.runs.filter((r) => r.status === "failed").length,
      pluginLogged: plugins.logs.length,
      pluginFailed: plugins.logs.filter((l) => l.failed).length
    }
  };
}

