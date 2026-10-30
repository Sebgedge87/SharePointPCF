import type { PcxConfig } from "./config.js";
import { envStatus, type EnvStatus, type Workspace } from "./environments.js";
import { acrossEnvs } from "./multi.js";
import { buildMatrix, filterMatrix, listSolutions, type MatrixRow, type Solution } from "./solutions.js";
import { runReport } from "./runs.js";
import { listProblemJobs } from "./jobs.js";
import { listConnectionRefs, listEnvVars } from "./configdata.js";
import { getSystemAudit } from "./audit.js";
import { evaluateAlerts, type Alert } from "./alerts.js";

export interface EnvHealth {
  status: EnvStatus;
  flowRuns?: number;
  flowFailed?: number;
  pluginErrors?: number;
  traceSetting?: string;
  jobsFailed?: number;
  jobsStuck?: number;
  varsMissing?: number;
  connectionsMissing?: number;
  auditOn?: boolean;
  topFailures: { name: string; kind: string; failures: number }[];
}

export interface HealthReport {
  generatedAt: string;
  days: number;
  environments: string[];
  /** Display names, keyed by short name. */
  labels?: Record<string, string>;
  health: Record<string, EnvHealth>;
  solutions: MatrixRow[];
  drift: MatrixRow[];
  alerts: Alert[];
}

/** Gathers everything for the health and drift report, from every environment at once. */
export async function buildReport(ws: Workspace, config: PcxConfig, days = 7, now = new Date()): Promise<HealthReport> {
  const since = new Date(now.getTime() - days * 86_400_000);
  const envs = config.environments;
  const [health, sols, alerts] = await Promise.all([
    acrossEnvs(ws, envs, async (client, env) => {
      const status = await envStatus(ws, env, true);
      const h: EnvHealth = { status, topFailures: [] };
      if (!status.connected) return h;
      const [runs, jobs, vars, refs, audit] = await Promise.allSettled([runReport(client, env, since), listProblemJobs(client, since, now), listEnvVars(client), listConnectionRefs(client), getSystemAudit(client)]);
      if (runs.status === "fulfilled") {
        h.flowRuns = runs.value.totals.flowRuns;
        h.flowFailed = runs.value.totals.flowFailed;
        h.pluginErrors = runs.value.totals.pluginFailed;
        h.traceSetting = runs.value.plugins.setting;
        h.topFailures = runs.value.top.slice(0, 5).map((g) => ({ name: g.name, kind: g.kind, failures: g.failures }));
      }
      if (jobs.status === "fulfilled") {
        h.jobsFailed = jobs.value.filter((j) => j.problem === "failed").length;
        h.jobsStuck = jobs.value.length - h.jobsFailed;
      }
      if (vars.status === "fulfilled") h.varsMissing = vars.value.filter((v) => v.missing).length;
      if (refs.status === "fulfilled") h.connectionsMissing = refs.value.filter((r) => !r.connected).length;
      if (audit.status === "fulfilled") h.auditOn = audit.value.auditEnabled;
      return h;
    }),
    acrossEnvs(ws, envs, (client) => listSolutions(client)),
    evaluateAlerts(ws, envs, new Date(now.getTime() - 86_400_000), now)
  ]);
  const names = envs.map((e) => e.name);
  const matrix = filterMatrix(buildMatrix(names, sols.results as Record<string, Solution[]>), {});
  return {
    generatedAt: now.toISOString(),
    days,
    environments: names,
    labels: Object.fromEntries(envs.map((e) => [e.name, e.label || e.name])),
    health: Object.fromEntries(names.map((n) => [n, health.results[n] ?? { status: { name: n, url: "", managed: true, connected: false, error: health.errors[n] }, topFailures: [] }])),
    solutions: matrix,
    drift: matrix.filter((r) => r.differs),
    alerts
  };
}

// ------------------------------------------------------------------ rendering

const esc = (v: unknown) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const num = (v: number | undefined) => (v === undefined ? "—" : String(v));

/** A self-contained, printable HTML report (save as PDF from the browser if needed). */
export function renderReportHtml(r: HealthReport): string {
  const envs = r.environments;
  const label = (e: string) => r.labels?.[e] ?? e;
  const th = envs.map((e) => `<th>${esc(label(e))}</th>`).join("");
  const row = (label: string, f: (h: EnvHealth) => string) => `<tr><th scope="row">${esc(label)}</th>${envs.map((e) => `<td>${f(r.health[e]!)}</td>`).join("")}</tr>`;
  const bad = (n: number | undefined) => (n ? `<span class="bad">${n}</span>` : num(n));
  const sev = { critical: "Critical", warning: "Warning", info: "Info" };
  const solTable = (rows: MatrixRow[]) =>
    rows.length === 0
      ? "<p class='muted'>None.</p>"
      : `<table><thead><tr><th>Solution</th><th>Publisher</th>${th}</tr></thead><tbody>${rows
          .map((s) => {
            const ref = s.versions[envs[envs.length - 1]!]?.version;
            return `<tr><th scope="row">${esc(s.friendlyName)}<div class="muted mono">${esc(s.uniqueName)}</div></th><td>${esc(s.publisher.friendlyName)}</td>${envs
              .map((e) => {
                const v = s.versions[e];
                if (v === undefined) return "<td class='muted'>?</td>";
                if (v === null) return "<td class='muted'>—</td>";
                return `<td class="mono${v.version !== ref ? " diff" : ""}">${esc(v.version)} ${v.isManaged ? "M" : "U"}</td>`;
              })
              .join("")}</tr>`;
          })
          .join("")}</tbody></table>`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Environment health report ${esc(r.generatedAt.slice(0, 10))}</title>
<style>
body{margin:0;background:#F6F8FA;color:#1B2A38;font:14px/1.5 "IBM Plex Sans","Segoe UI",system-ui,sans-serif}
main{max-width:1200px;margin:0 auto;padding:32px 24px 48px}
h1,h2{font-family:Rubik,"Segoe UI",system-ui,sans-serif;color:#0A4873;margin:0}
h1{font-size:28px}h2{font-size:18px;margin:32px 0 12px}
.eyebrow{font-size:12px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:#BB1C73}
.muted{color:#4D6A82}.mono{font-family:"IBM Plex Mono",Consolas,monospace;font-size:12px}
table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #D5DEE7;border-radius:8px;overflow:hidden;font-size:13px}
th,td{padding:8px 10px;border-bottom:1px solid #E6ECF1;text-align:left;vertical-align:top}
thead th{background:#F0F3F6;color:#4D6A82;font-weight:500}
tbody th{font-weight:600}
.bad{color:#8E1B1B;font-weight:700}.diff{background:#E3EEF7;color:#0A4873;font-weight:600}
.sev{display:inline-block;padding:1px 8px;border-radius:999px;font-size:11px;font-weight:700}
.critical{background:#FCE8E8;color:#8E1B1B}.warning{background:#FDF1DC;color:#7A4600}.info{background:#E3EEF7;color:#0A4873}
@media print{body{background:#fff}main{padding:0}h2{break-after:avoid}table{break-inside:auto}tr{break-inside:avoid}}
</style></head><body><main>
<div class="eyebrow">Env Console</div>
<h1>Environment health report</h1>
<p class="muted">Generated ${esc(new Date(r.generatedAt).toUTCString())} · activity over the last ${r.days} days · ${envs.length} environments</p>

<h2>Health</h2>
<table><thead><tr><th></th>${th}</tr></thead><tbody>
${row("Reachable", (h) => (h.status.connected ? "Yes" : `<span class="bad">No</span><div class="muted">${esc(h.status.error ?? "")}</div>`))}
${row("Type", (h) => (h.status.managed ? "Managed" : "Unmanaged"))}
${row("Version", (h) => esc(h.status.version ?? "—"))}
${row("Solutions", (h) => num(h.status.solutions))}
${row("Flows switched on", (h) => (h.status.flowsTotal === undefined ? "—" : `${h.status.flowsOn} / ${h.status.flowsTotal}`))}
${row("Plugin steps switched on", (h) => (h.status.pluginStepsTotal === undefined ? "—" : `${h.status.pluginStepsOn} / ${h.status.pluginStepsTotal}`))}
${row(`Flow runs (${r.days} days)`, (h) => num(h.flowRuns))}
${row("Failed flow runs", (h) => bad(h.flowFailed))}
${row("Plugin errors", (h) => bad(h.pluginErrors))}
${row("Plugin trace log", (h) => esc(h.traceSetting ?? "—"))}
${row("Failed background jobs", (h) => bad(h.jobsFailed))}
${row("Suspended or stuck jobs", (h) => bad(h.jobsStuck))}
${row("Variables without a value", (h) => bad(h.varsMissing))}
${row("Connections not set", (h) => bad(h.connectionsMissing))}
${row("Auditing", (h) => (h.auditOn === undefined ? "—" : h.auditOn ? "On" : '<span class="bad">Off</span>'))}
${row("Most failures", (h) => h.topFailures.map((f) => `${esc(f.name)} <span class="bad">${f.failures}</span>`).join("<br>") || "—")}
</tbody></table>

<h2>Alerts (last 24 hours)</h2>
${r.alerts.length === 0 ? "<p class='muted'>No alerts.</p>" : `<table><thead><tr><th>Severity</th><th>Environment</th><th>Alert</th><th>Detail</th></tr></thead><tbody>${r.alerts.map((a) => `<tr><td><span class="sev ${a.severity}">${sev[a.severity]}</span></td><td>${esc(label(a.env))}</td><td>${esc(a.title)}</td><td class="muted">${esc(a.detail ?? "")}</td></tr>`).join("")}</tbody></table>`}

<h2>Solution drift (${r.drift.length})</h2>
<p class="muted">Solutions whose version differs between environments, or that are missing from one. Highlighted versions differ from ${esc(label(envs[envs.length - 1] ?? ""))}.</p>
${solTable(r.drift)}

<h2>All solutions (${r.solutions.length})</h2>
<p class="muted">Microsoft solutions are left out. M = managed, U = unmanaged.</p>
${solTable(r.solutions)}
</main></body></html>`;
}

/** One CSV row per environment with the health figures. */
export function renderReportCsv(r: HealthReport): string {
  const cols = ["environment", "reachable", "managed", "version", "solutions", "flow_runs", "flow_failed", "plugin_errors", "trace_log", "jobs_failed", "jobs_stuck", "variables_missing", "connections_missing", "auditing", "solutions_drifting"];
  const q = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = r.environments.map((e) => {
    const h = r.health[e]!;
    return [e, h.status.connected, h.status.managed, h.status.version, h.status.solutions, h.flowRuns, h.flowFailed, h.pluginErrors, h.traceSetting, h.jobsFailed, h.jobsStuck, h.varsMissing, h.connectionsMissing, h.auditOn, r.drift.filter((d) => d.versions[e] !== undefined).length]
      .map(q)
      .join(",");
  });
  return [cols.join(","), ...lines].join("\r\n") + "\r\n";
}
