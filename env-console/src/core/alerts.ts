import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { EnvConfig } from "./config.js";
import type { DataverseClient } from "./dataverse.js";
import { whoAmI, type Workspace } from "./environments.js";
import { getTraceSetting, listFlowRuns, listPluginLogs } from "./runs.js";
import { listProblemJobs } from "./jobs.js";
import { listConnectionRefs, listEnvVars } from "./configdata.js";
import { getSystemAudit } from "./audit.js";

export type Severity = "critical" | "warning" | "info";

export interface Alert {
  /** Stable fingerprint, so the same problem is only posted once. */
  id: string;
  env: string;
  severity: Severity;
  kind: "access" | "flow" | "plugin" | "tracing" | "jobs" | "variable" | "connection" | "audit";
  title: string;
  detail?: string;
  /** Dashboard route that shows it, e.g. "#/runs". */
  route: string;
}

const day = (d: Date) => d.toISOString().slice(0, 10);

async function envAlerts(client: DataverseClient, env: EnvConfig, since: Date, now: Date): Promise<Alert[]> {
  const out: Alert[] = [];
  const add = (a: Omit<Alert, "env">) => out.push({ ...a, env: env.name });
  try {
    await whoAmI(client);
  } catch (e) {
    add({ id: `${env.name}|access`, severity: "critical", kind: "access", title: `Can't reach ${env.name}`, detail: (e as Error).message, route: "#/overview" });
    return out;
  }
  const checks: Promise<void>[] = [
    listFlowRuns(client, since, { failedOnly: true }).then((r) => {
      const by = new Map<string, { n: number; last?: string }>();
      for (const run of r.runs) {
        const g = by.get(run.flowName) ?? { n: 0 };
        g.n++;
        g.last ??= run.errorMessage ?? run.errorCode;
        by.set(run.flowName, g);
      }
      for (const [flow, g] of by) add({ id: `${env.name}|flow|${flow}|${day(now)}`, severity: "warning", kind: "flow", title: `Flow "${flow}" failed ${g.n} time${g.n === 1 ? "" : "s"}`, detail: g.last?.split("\n")[0]?.slice(0, 200), route: "#/runs" });
    }),
    listPluginLogs(client, since, { failedOnly: true }).then((logs) => {
      const by = new Map<string, { n: number; last?: string }>();
      for (const l of logs) {
        const g = by.get(l.typeName) ?? { n: 0 };
        g.n++;
        g.last ??= l.exception;
        by.set(l.typeName, g);
      }
      for (const [p, g] of by) add({ id: `${env.name}|plugin|${p}|${day(now)}`, severity: "warning", kind: "plugin", title: `Plugin ${p} failed ${g.n} time${g.n === 1 ? "" : "s"}`, detail: g.last?.split("\n")[0]?.slice(0, 200), route: "#/runs" });
    }),
    getTraceSetting(client).then((t) => {
      if (t.setting === "off" && env.managed) add({ id: `${env.name}|tracing`, severity: "info", kind: "tracing", title: "Plugin tracing is off", detail: "Plugin errors are not recorded. Set it to Exceptions.", route: "#/runs" });
    }),
    listProblemJobs(client, since, now).then((jobs) => {
      const failed = jobs.filter((j) => j.problem === "failed").length;
      const stuck = jobs.filter((j) => j.problem !== "failed").length;
      if (failed) add({ id: `${env.name}|jobs-failed|${day(now)}`, severity: "warning", kind: "jobs", title: `${failed} background job${failed === 1 ? "" : "s"} failed`, detail: jobs.find((j) => j.problem === "failed")?.message?.split("\n")[0]?.slice(0, 200), route: "#/jobs" });
      if (stuck) add({ id: `${env.name}|jobs-stuck|${day(now)}`, severity: "warning", kind: "jobs", title: `${stuck} background job${stuck === 1 ? " is" : "s are"} suspended or stuck`, route: "#/jobs" });
    }),
    listEnvVars(client).then((vars) => {
      for (const v of vars.filter((x) => x.missing)) add({ id: `${env.name}|variable|${v.schemaName}`, severity: "warning", kind: "variable", title: `Environment variable ${v.schemaName} has no value`, route: "#/config" });
    }),
    listConnectionRefs(client).then((refs) => {
      for (const r of refs.filter((x) => !x.connected)) add({ id: `${env.name}|connection|${r.logicalName}`, severity: env.managed ? "critical" : "warning", kind: "connection", title: `Connection reference ${r.displayName} has no connection`, detail: `${r.connector} · flows using it can't run`, route: "#/config" });
    }),
    getSystemAudit(client).then((a) => {
      if (!a.auditEnabled && env.managed) add({ id: `${env.name}|audit`, severity: "warning", kind: "audit", title: "Auditing is off", detail: "Changes to records are not being recorded.", route: "#/audit" });
    })
  ];
  // A check that can't run (no permission, table missing) is skipped rather than failing the rest.
  await Promise.allSettled(checks);
  return out;
}

const ORDER: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };

export async function evaluateAlerts(ws: Workspace, envs: EnvConfig[], since: Date, now = new Date()): Promise<Alert[]> {
  const all = await Promise.all(envs.map((e) => envAlerts(ws.client(e), e, since, now)));
  return all.flat().sort((a, b) => ORDER[a.severity] - ORDER[b.severity] || a.env.localeCompare(b.env) || a.title.localeCompare(b.title));
}

// ------------------------------------------------------------------ Teams

const WEBHOOK_HOSTS = [".webhook.office.com", ".logic.azure.com", ".api.powerplatform.com", ".environment.api.powerplatform.com"];

export function validateWebhook(url: string): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new Error("Not a valid URL");
  }
  if (u.protocol !== "https:" || !WEBHOOK_HOSTS.some((h) => u.hostname.endsWith(h))) {
    throw new Error("Use a Teams incoming webhook or a Teams Workflows (Power Automate) webhook URL");
  }
  return u.toString();
}

const ICON: Record<Severity, string> = { critical: "🔴", warning: "🟠", info: "🔵" };

/** An Adaptive Card message, accepted by Teams Workflows webhooks and incoming webhooks. */
export function teamsMessage(alerts: Alert[], dashboardUrl?: string): unknown {
  const body: unknown[] = [
    { type: "TextBlock", size: "Medium", weight: "Bolder", text: `Env Console: ${alerts.length} new alert${alerts.length === 1 ? "" : "s"}` }
  ];
  for (const a of alerts.slice(0, 25)) {
    body.push({ type: "TextBlock", wrap: true, spacing: "Small", text: `${ICON[a.severity]} **${a.env}** · ${a.title}` });
    if (a.detail) body.push({ type: "TextBlock", wrap: true, isSubtle: true, spacing: "None", text: a.detail });
  }
  if (alerts.length > 25) body.push({ type: "TextBlock", isSubtle: true, text: `…and ${alerts.length - 25} more` });
  const content: Record<string, unknown> = { $schema: "http://adaptivecards.io/schemas/adaptive-card.json", type: "AdaptiveCard", version: "1.4", body };
  if (dashboardUrl) content.actions = [{ type: "Action.OpenUrl", title: "Open Env Console", url: dashboardUrl }];
  return { type: "message", attachments: [{ contentType: "application/vnd.microsoft.card.adaptive", content }] };
}

export async function postToTeams(webhook: string, alerts: Alert[], opts: { dashboardUrl?: string; fetchImpl?: typeof fetch } = {}): Promise<void> {
  const f = opts.fetchImpl ?? fetch;
  const res = await f(validateWebhook(webhook), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(teamsMessage(alerts, opts.dashboardUrl)) });
  if (!res.ok) throw new Error(`Teams returned HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

// ------------------------------------------------------------------ "already posted" memory

export function alertStatePath(): string {
  return process.env.PCX_ALERT_STATE ?? join(homedir(), ".pcx", "alerts-state.json");
}

/** Alerts not posted in the last 14 days. */
export function newAlerts(alerts: Alert[], path = alertStatePath(), now = new Date()): Alert[] {
  const posted = readState(path);
  return alerts.filter((a) => !posted[a.id] || now.getTime() - new Date(posted[a.id]!).getTime() > 14 * 86_400_000);
}

export function rememberPosted(alerts: Alert[], path = alertStatePath(), now = new Date()): void {
  const posted = readState(path);
  for (const [k, v] of Object.entries(posted)) if (now.getTime() - new Date(v).getTime() > 30 * 86_400_000) delete posted[k];
  for (const a of alerts) posted[a.id] = now.toISOString();
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, JSON.stringify(posted, null, 1), { mode: 0o600 });
}

function readState(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, string>;
  } catch {
    return {};
  }
}
