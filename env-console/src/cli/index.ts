#!/usr/bin/env node
import { spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { createProvider } from "../core/auth.js";
import { defaultConfigPath, findEnv, loadConfig, normaliseEnvUrl, saveConfig, validateConfig, type EnvConfig, type PcxConfig } from "../core/config.js";
import { changeState, checkPolicy, listComponents, selectComponents, type ComponentKind } from "../core/components.js";
import { envStatus, whoAmI, Workspace } from "../core/environments.js";
import { buildMatrix, filterMatrix, listSolutions, type Solution } from "../core/solutions.js";
import { startServer } from "../server/index.js";
import { compareSolution } from "../core/compare.js";
import { getTraceSetting, runReport, setTraceSetting, type TraceSetting } from "../core/runs.js";
import { getSystemAudit, listAuditEntries, listColumnAudit, listTableAudit, setAudit } from "../core/audit.js";
import { applyUserSettings, listUserSettings, planApply, REGIONS, validateSettings, type UserScope } from "../core/usersettings.js";
import { sinceDate } from "../core/util.js";
import { writeFileSync } from "node:fs";
import { acrossEnvs, matrix } from "../core/multi.js";
import { evaluateAlerts, newAlerts, postToTeams, rememberPosted, validateWebhook } from "../core/alerts.js";
import { buildReport, renderReportCsv, renderReportHtml } from "../core/report.js";
import { changeJobs, listProblemJobs } from "../core/jobs.js";
import { listRoles, listUserRoles } from "../core/security.js";
import { listConnectionRefs, listEnvVars, setEnvVarValue } from "../core/configdata.js";
import { runProcess } from "../core/proc.js";
import { discoverEnvironments } from "../core/discovery.js";
import { HostedAuth, loadHostedSettings } from "../server/hosted.js";
import { c, table } from "./format.js";

const VERSION = "0.1.0";

const HELP = `pcx ${VERSION} — Power Platform environment console

Sign-in
  pcx auth login [--device-code]        Sign in with PowerShell (Connect-AzAccount) or Azure CLI
  pcx auth status                       Check sign-in against every environment

Environments
  pcx env list [--json]                 Health, version, solutions, flows and plugin steps
  pcx env discover [--json]              List every environment your account can reach
  pcx env add <NAME> <URL> [--unmanaged]
  pcx env remove <NAME>

Solutions
  pcx solution list [--env NAME]... [--publisher P]... [--include-microsoft]
                    [--diff-only] [--search TEXT] [--json]
  pcx solution diff <UniqueName> --from ENV --to ENV [--show-same] [--json]
                                        Component-by-component compare (exit 1 on differences)

Flows, business rules and plugin steps
  pcx flows|rules|plugins list --env NAME [--off] [--include-system] [--json]
  pcx flows|rules|plugins on|off --env NAME (<name-or-id>... | --filter TEXT | --all)
                    [--reason TEXT] [--dry-run] [--yes]

Run history
  pcx runs list --env NAME [--since 24h|7d] [--failed] [--json]
  pcx runs trace --env NAME [--set off|exceptions|all --reason TEXT]

Audit
  pcx audit status --env NAME
  pcx audit tables --env NAME [--off] [--json]
  pcx audit columns --env NAME --table T
  pcx audit log --env NAME --table T [--column C] [--since 7d]
  pcx audit set on|off --env NAME --table T [--table T2]... [--column C]... --reason TEXT

User settings
  pcx usersettings show --env NAME [--role R | --team T | --bu B]
  pcx usersettings apply --env NAME [--region en-GB] [--date-format dd/MM/yyyy]
                    [--time-format HH:mm] [--timezone 85] [--language 1033] [--paging 50]
                    [--role R | --team T | --bu B] [--overwrite] [--new-users]
                    [--dry-run] [--yes] [--reason TEXT]

Across all environments
  pcx flows|rules|plugins list          (no --env) one column per environment
  pcx security users [--diff-only]      Users and their roles in every environment
  pcx security roles                    Which roles exist where
  pcx vars list                         Environment variable values in every environment
  pcx vars set --env NAME <schema> <value> --reason TEXT
  pcx connections list                  Connection references and whether they are connected
  pcx jobs list [--env NAME] [--since 7d]   Failed, suspended or stuck background jobs
  pcx jobs cancel|resume --env NAME <job-id>... --reason TEXT

Alerts and reports
  pcx alerts list                       Current problems across all environments
  pcx alerts run --post [--all]         Post new alerts to Teams (needs teams-webhook)
  pcx alerts schedule [--every 60] [--install]   Check on a schedule (Windows Task Scheduler)
  pcx report [--days 7] [--format html|csv|json] [--out FILE]

Dashboard
  pcx serve [--port 4820] [--open]      Start the dashboard on this machine (--open opens the browser)

Other
  pcx config path                       Show which config file is used
  pcx config set tenant <id-or-domain>  Sign in to a specific tenant (empty to clear)
  pcx config set provider azps|azcli    Sign in with PowerShell (default) or Azure CLI
  pcx config set teams-webhook <url>    Teams channel for alerts (empty to remove)
  --config FILE                         Use this config file (any command)

Changes in managed environments (everything except unmanaged DEV) need --reason.
Config: ./pcx.config.json, or ~/.pcx/config.json, or the PCX_CONFIG variable.`;

class UsageError extends Error {}

function opts(argv: string[]) {
  return parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: {
      env: { type: "string", multiple: true },
      publisher: { type: "string", multiple: true },
      "include-microsoft": { type: "boolean" },
      "diff-only": { type: "boolean" },
      search: { type: "string" },
      json: { type: "boolean" },
      all: { type: "boolean" },
      filter: { type: "string" },
      reason: { type: "string" },
      "dry-run": { type: "boolean" },
      yes: { type: "boolean", short: "y" },
      off: { type: "boolean" },
      "device-code": { type: "boolean" },
      unmanaged: { type: "boolean" },
      port: { type: "string" },
      open: { type: "boolean" },
      "include-system": { type: "boolean" },
      from: { type: "string" },
      to: { type: "string" },
      since: { type: "string" },
      failed: { type: "boolean" },
      set: { type: "string" },
      table: { type: "string", multiple: true },
      column: { type: "string", multiple: true },
      region: { type: "string" },
      "date-format": { type: "string" },
      "time-format": { type: "string" },
      timezone: { type: "string" },
      language: { type: "string" },
      paging: { type: "string" },
      overwrite: { type: "boolean" },
      "new-users": { type: "boolean" },
      role: { type: "string" },
      team: { type: "string" },
      bu: { type: "string" },
      "show-same": { type: "boolean" },
      every: { type: "string" },
      install: { type: "boolean" },
      post: { type: "boolean" },
      days: { type: "string" },
      format: { type: "string" },
      out: { type: "string" },
      config: { type: "string" },
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" }
    }
  });
}

type Opts = ReturnType<typeof opts>["values"];

function out(s: string): void {
  process.stdout.write(s + "\n");
}

function envsFrom(config: PcxConfig, names?: string[]): EnvConfig[] {
  if (config.environments.length === 0) throw new UsageError("No environments configured. Add one: pcx env add DEV https://<org>.crm.dynamics.com --unmanaged");
  return names && names.length ? names.map((n) => findEnv(config, n)) : config.environments;
}

function oneEnv(config: PcxConfig, o: Opts): EnvConfig {
  if (!o.env || o.env.length !== 1) throw new UsageError("Choose one environment with --env NAME");
  return findEnv(config, o.env[0]!);
}

async function cmdAuth(sub: string | undefined, o: Opts, config: PcxConfig): Promise<number> {
  if (sub === "login") {
    const provider = createProvider(config.auth.provider);
    out(c.dim(`Signing in with ${provider.name === "azps" ? "PowerShell (Connect-AzAccount)" : "Azure CLI (az login)"}…`));
    await provider.login(config.tenantId, !!o["device-code"]);
    if (config.environments.length) return cmdAuth("status", o, config);
    return 0;
  }
  if (sub === "status") {
    const ws = new Workspace(config);
    const res = await Promise.all(envsFrom(config).map((e) => envStatus(ws, e, false)));
    out(table(["ENV", "AUTH", "USER / ERROR"], res.map((r) => [r.name, r.connected ? c.green("connected") : c.red(r.needsLogin ? "sign-in needed" : "failed"), r.connected ? r.user ?? "" : r.error ?? ""])));
    return res.every((r) => r.connected) ? 0 : 1;
  }
  throw new UsageError("Usage: pcx auth login|status");
}

async function cmdEnv(sub: string | undefined, pos: string[], o: Opts, config: PcxConfig, configPath: string): Promise<number> {
  if (sub === "list") {
    const ws = new Workspace(config);
    const res = await Promise.all(envsFrom(config).map((e) => envStatus(ws, e, true)));
    if (o.json) return out(JSON.stringify(res, null, 2)), 0;
    out(
      table(
        ["NAME", "TYPE", "AUTH", "VERSION", "SOLUTIONS", "FLOWS ON", "PLUGIN STEPS ON", "URL"],
        res.map((r) => [
          r.name,
          r.managed ? "managed" : "unmanaged",
          r.connected ? c.green("connected") : c.red(r.needsLogin ? "sign-in needed" : "failed"),
          r.version ?? "-",
          r.solutions?.toString() ?? "-",
          r.flowsTotal !== undefined ? `${r.flowsOn}/${r.flowsTotal}` : "-",
          r.pluginStepsTotal !== undefined ? `${r.pluginStepsOn}/${r.pluginStepsTotal}` : "-",
          r.url
        ])
      )
    );
    for (const r of res) if (r.error) out(c.yellow(`${r.name}: ${r.error}`));
    return res.every((r) => r.connected) ? 0 : 1;
  }
  if (sub === "add") {
    const [name, url] = pos;
    if (!name || !url) throw new UsageError("Usage: pcx env add <NAME> <URL> [--unmanaged]");
    if (config.environments.some((e) => e.name.toUpperCase() === name.toUpperCase())) throw new UsageError(`${name} already exists`);
    const env: EnvConfig = { name, url: normaliseEnvUrl(url, undefined), managed: !o.unmanaged };
    saveConfig({ ...config, environments: [...config.environments, env] }, configPath);
    out(`${c.green("✓")} Added ${name} (${env.managed ? "managed" : "unmanaged"}) ${env.url} to ${configPath}`);
    return 0;
  }
  if (sub === "discover") {
    const found = await discoverEnvironments(new Workspace(config).tokens);
    const have = new Set(config.environments.map((e) => e.url));
    if (o.json) return out(JSON.stringify(found, null, 2)), 0;
    out(table(["", "SUGGESTED", "NAME", "URL", "REGION"], found.map((f) => [have.has(f.url) ? c.green("added") : f.enabled ? "" : c.dim("disabled"), f.suggestedName, f.friendlyName, f.url, f.region ?? ""])));
    out(c.dim(`${found.length} environments you can reach. Add one with: pcx env add <NAME> <URL> [--unmanaged]`));
    return 0;
  }
  if (sub === "remove") {
    const env = findEnv(config, pos[0] ?? "");
    saveConfig({ ...config, environments: config.environments.filter((e) => e !== env) }, configPath);
    out(`${c.green("✓")} Removed ${env.name}`);
    return 0;
  }
  throw new UsageError("Usage: pcx env list|discover|add|remove");
}

async function cmdSolution(sub: string | undefined, pos: string[], o: Opts, config: PcxConfig): Promise<number> {
  if (sub === "diff") return cmdSolutionDiff(pos, o, config);
  if (sub !== "list") throw new UsageError("Usage: pcx solution list [options] | pcx solution diff <UniqueName> --from ENV --to ENV");
  const envs = envsFrom(config, o.env);
  const ws = new Workspace(config);
  const perEnv: Record<string, Solution[]> = {};
  const errors: string[] = [];
  await Promise.all(
    envs.map(async (e) => {
      try {
        perEnv[e.name] = await listSolutions(ws.client(e));
      } catch (err) {
        errors.push(`${e.name}: ${(err as Error).message}`);
      }
    })
  );
  const names = envs.map((e) => e.name);
  const rows = filterMatrix(buildMatrix(names, perEnv), { publishers: o.publisher, includeMicrosoft: o["include-microsoft"], diffOnly: o["diff-only"], search: o.search });
  if (o.json) {
    out(JSON.stringify({ environments: names, rows, errors }, null, 2));
    return errors.length ? 1 : 0;
  }
  const loaded = names.filter((n) => perEnv[n]);
  out(
    table(
      ["SOLUTION", "PUBLISHER", "PREFIX", ...loaded],
      rows.map((r) => {
        const ref = r.versions[loaded[loaded.length - 1]!]?.version;
        return [
          `${r.friendlyName} ${c.dim(r.uniqueName)}`,
          r.publisher.friendlyName,
          r.publisher.prefix,
          ...loaded.map((n) => {
            const v = r.versions[n];
            if (!v) return c.dim("—");
            const s = `${v.version} ${v.isManaged ? "M" : "U"}`;
            return v.version !== ref ? c.blue(s) : s;
          })
        ];
      })
    )
  );
  out(c.dim(`${rows.length} solutions. M = managed, U = unmanaged. Blue = differs from ${loaded[loaded.length - 1] ?? "last environment"}.${o["include-microsoft"] ? "" : " Microsoft solutions hidden (--include-microsoft)."}`));
  for (const e of errors) out(c.red(e));
  return errors.length ? 1 : 0;
}

const KIND: Record<string, ComponentKind> = { flows: "flow", rules: "rule", plugins: "plugin" };
const NOUN: Record<ComponentKind, string> = { flow: "flow", rule: "business rule", plugin: "plugin step" };

async function cmdComponents(group: string, sub: string | undefined, pos: string[], o: Opts, config: PcxConfig): Promise<number> {
  const kind = KIND[group]!;
  if (sub === "list" && (!o.env || o.env.length !== 1)) return cmdComponentsMatrix(kind, o, config);
  const env = oneEnv(config, o);
  const ws = new Workspace(config);
  const client = ws.client(env);
  const all = await listComponents(client, kind, { includeSystem: !!o["include-system"] });
  if (sub === "list") {
    const rows = o.off ? all.filter((x) => !x.on) : all;
    if (o.json) return out(JSON.stringify(rows, null, 2)), 0;
    out(table(["STATE", "NAME", "TARGET", "SOLUTION", "ID"], rows.map((r) => [r.on ? c.green("on") : c.dim("off"), r.custom ? r.name : `${r.name} ${c.dim("(Microsoft/system)")}`, r.target, r.solution ?? "", c.dim(r.id)])));
    out(c.dim(`${rows.length} ${NOUN[kind]}s in ${env.name}${o["include-system"] ? "" : " (custom only; add --include-system for Microsoft and system items)"}`));
    return 0;
  }
  if (sub !== "on" && sub !== "off") throw new UsageError(`Usage: pcx ${group} list|on|off --env NAME`);
  const on = sub === "on";
  if (!o.all && !o.filter && pos.length === 0) throw new UsageError(`Name the ${NOUN[kind]}s to change, or use --filter TEXT or --all`);
  const picked = selectComponents(all, { names: pos, filter: o.filter, all: o.all }).filter((x) => x.on !== on);
  if (picked.length === 0) {
    out(`Nothing to change: every matching ${NOUN[kind]} is already ${sub}.`);
    return 0;
  }
  checkPolicy(env, o.reason);
  out(`${o["dry-run"] ? "Would turn" : "Turning"} ${sub} ${picked.length} ${NOUN[kind]}(s) in ${env.name}:`);
  for (const p of picked) out(`  ${p.name} ${c.dim(p.id)}`);
  if (o["dry-run"]) return 0;
  if (env.managed && picked.length > 1 && !o.yes) {
    out(c.yellow(`${env.name} is managed. Re-run with --yes to change these ${picked.length} items.`));
    return 2;
  }
  let actor: string | undefined;
  try {
    actor = (await whoAmI(client)).user;
  } catch {
    /* logged without actor */
  }
  const results = await changeState(client, { kind, items: picked, on, reason: o.reason, actor, source: "cli" });
  for (const r of results) out(`${r.ok ? c.green("✓") : c.red("✗")} ${r.name}${r.error ? c.red(` — ${r.error}`) : ""}`);
  return results.every((r) => r.ok) ? 0 : 1;
}

/**
 * Hosted mode (Azure App Service and similar): settings come from app settings.
 * Environments come from PCX_ENVIRONMENTS (JSON list) or the usual config file.
 */
async function serveHosted(fileConfig: PcxConfig): Promise<number> {
  const settings = loadHostedSettings();
  let config = fileConfig;
  if (process.env.PCX_ENVIRONMENTS) {
    let envs: unknown;
    try {
      envs = JSON.parse(process.env.PCX_ENVIRONMENTS);
    } catch {
      throw new UsageError('PCX_ENVIRONMENTS must be JSON, e.g. [{"name":"DEV","url":"https://org-dev.crm11.dynamics.com","managed":false}]');
    }
    config = validateConfig({ tenantId: settings.tenantId, environments: envs, allowedHostSuffixes: fileConfig.allowedHostSuffixes });
  }
  if (config.environments.length === 0) throw new UsageError("No environments configured. Set the PCX_ENVIRONMENTS app setting.");
  const port = Number(process.env.PORT ?? 8080);
  const s = await startServer({ config, port, mode: { kind: "hosted", auth: new HostedAuth(settings, config) } });
  out(`Env Console (hosted) listening on port ${s.port} for ${settings.publicUrl} · ${config.environments.length} environments`);
  return await new Promise<number>(() => {});
}

const STATUS_LABEL: Record<string, (s: string) => string> = {
  layer: (s) => c.yellow(s),
  different: (s) => c.blue(s),
  onlyA: (s) => c.red(s),
  onlyB: (s) => c.red(s),
  present: (s) => c.dim(s),
  same: (s) => c.green(s)
};

async function cmdSolutionDiff(pos: string[], o: Opts, config: PcxConfig): Promise<number> {
  const name = pos[0];
  if (!name || !o.from || !o.to) throw new UsageError("Usage: pcx solution diff <UniqueName> --from ENV --to ENV [--show-same] [--json]");
  const ws = new Workspace(config);
  const a = findEnv(config, o.from);
  const b = findEnv(config, o.to);
  const r = await compareSolution(ws.client(a), ws.client(b), name);
  const differs = r.rows.some((x) => ["different", "layer", "onlyA", "onlyB"].includes(x.status));
  if (o.json) return out(JSON.stringify(r, null, 2)), differs ? 1 : 0;
  out(`${c.bold(name)}  ${a.name} ${r.a.version ?? "not installed"}  →  ${b.name} ${r.b.version ?? "not installed"}`);
  const names: Record<string, string> = { layer: "UNMANAGED CHANGE", different: "DIFFERENT", onlyA: `ONLY IN ${a.name}`, onlyB: `ONLY IN ${b.name}`, present: "IN BOTH", same: "SAME" };
  const rows = r.rows.filter((x) => o["show-same"] || (x.status !== "same" && x.status !== "present"));
  out(table(["STATUS", "TYPE", "NAME", "TABLE"], rows.map((x) => [STATUS_LABEL[x.status]!(names[x.status] ?? x.status), x.typeName, x.name, x.parent ?? ""])));
  out(c.dim(`${r.counts.same} same · ${r.counts.different} different · ${r.counts.layer} unmanaged changes · ${r.counts.onlyA} only in ${a.name} · ${r.counts.onlyB} only in ${b.name} · ${r.counts.present} in both (not compared)`));
  return differs ? 1 : 0;
}

const firstLine = (s: string | undefined, n = 80) => (s ?? "").split("\n")[0]!.slice(0, n);
const when = (iso: string) => iso.replace("T", " ").slice(0, 16);

async function cmdRuns(sub: string | undefined, o: Opts, config: PcxConfig): Promise<number> {
  const env = oneEnv(config, o);
  const client = new Workspace(config).client(env);
  if (sub === "trace") {
    if (!o.set) {
      const t = await getTraceSetting(client);
      out(`Plugin trace log in ${env.name}: ${c.bold(t.setting)}`);
      return 0;
    }
    if (!["off", "exceptions", "all"].includes(o.set)) throw new UsageError("--set must be off, exceptions or all");
    const actor = await whoAmI(client).then((x) => x.user, () => undefined);
    await setTraceSetting(client, o.set as TraceSetting, o.reason, actor, "cli");
    out(`${c.green("✓")} Plugin trace log in ${env.name} set to ${o.set}`);
    return 0;
  }
  if (sub !== "list") throw new UsageError("Usage: pcx runs list --env NAME [--since 7d] [--failed] [--json] | pcx runs trace --env NAME [--set off|exceptions|all --reason TEXT]");
  const r = await runReport(client, env, sinceDate(o.since ?? "24h"));
  if (o.json) return out(JSON.stringify(r, null, 2)), 0;
  out(c.bold(`Flows: ${r.totals.flowRuns} runs, ${r.totals.flowFailed} failed`));
  if (!r.flows.available) out(c.yellow(r.flows.error ?? "Flow run history is not available"));
  const flows = o.failed ? r.flows.runs.filter((x) => x.status === "failed") : r.flows.runs;
  out(table(["WHEN", "STATUS", "FLOW", "ERROR"], flows.slice(0, 50).map((x) => [when(x.start), x.status === "failed" ? c.red("failed") : x.status === "succeeded" ? c.green("ok") : x.status, x.flowName, `${x.errorCode ?? ""} ${firstLine(x.errorMessage)}`.trim()])));
  out("");
  out(c.bold(`Plugins: ${r.totals.pluginFailed} errors · trace log ${r.plugins.setting ?? "unknown"}`));
  if (r.plugins.setting === "off") out(c.yellow(`Plugin tracing is off, so plugin errors are not recorded. Turn it on: pcx runs trace --env ${env.name} --set exceptions --reason "..."`));
  if (r.plugins.error) out(c.yellow(r.plugins.error));
  const logs = o.failed ? r.plugins.logs.filter((x) => x.failed) : r.plugins.logs;
  out(table(["WHEN", "STATUS", "PLUGIN", "MESSAGE", "ERROR"], logs.slice(0, 50).map((x) => [when(x.at), x.failed ? c.red("failed") : c.green("ok"), x.typeName, `${x.table ?? ""} ${x.message}`.trim(), firstLine(x.exception)])));
  if (r.top.length) {
    out("");
    out(c.bold("Most failures"));
    out(table(["FAILURES", "OF", "KIND", "NAME"], r.top.slice(0, 10).map((g) => [String(g.failures), String(g.total), g.kind, g.name])));
  }
  return 0;
}

async function cmdAudit(sub: string | undefined, pos: string[], o: Opts, config: PcxConfig): Promise<number> {
  const env = oneEnv(config, o);
  const client = new Workspace(config).client(env);
  if (sub === "status") {
    const s = await getSystemAudit(client);
    out(
      table(["SETTING", "VALUE"], [
        ["Auditing", s.auditEnabled ? c.green("on") : c.red("off")],
        ["User sign-in logging", s.userAccessAudit ? "on" : "off"],
        ["Retention", s.retentionDays === undefined ? "?" : s.retentionDays < 0 ? "forever" : `${s.retentionDays} days`]
      ])
    );
    return 0;
  }
  if (sub === "tables") {
    const t = await listTableAudit(client);
    const rows = o.off ? t.filter((x) => !x.auditEnabled) : t;
    if (o.json) return out(JSON.stringify(rows, null, 2)), 0;
    out(table(["AUDIT", "TABLE", "LOGICAL NAME"], rows.map((x) => [x.auditEnabled ? c.green("on") : c.dim("off"), x.displayName, x.logicalName])));
    return 0;
  }
  const tableName = o.table?.[0];
  if (sub === "columns") {
    if (!tableName) throw new UsageError("Usage: pcx audit columns --env NAME --table LOGICALNAME");
    const cols = await listColumnAudit(client, tableName);
    if (o.json) return out(JSON.stringify(cols, null, 2)), 0;
    out(table(["AUDIT", "COLUMN", "LOGICAL NAME", "TYPE"], cols.map((x) => [x.auditEnabled ? c.green("on") : c.dim("off"), x.displayName, x.logicalName, x.type])));
    return 0;
  }
  if (sub === "log") {
    if (!tableName) throw new UsageError("Usage: pcx audit log --env NAME --table LOGICALNAME [--column NAME] [--since 7d]");
    const entries = await listAuditEntries(client, tableName, sinceDate(o.since ?? "7d"), { column: o.column?.[0] });
    if (o.json) return out(JSON.stringify(entries, null, 2)), 0;
    out(table(["WHEN", "WHO", "ACTION", "RECORD", "CHANGES"], entries.slice(0, 100).map((e) => [when(e.at), e.user, e.action, e.record, e.changes.map((x) => `${x.column}: ${x.old || "∅"} → ${x.new || "∅"}`).join("; ").slice(0, 100)])));
    return 0;
  }
  if (sub === "set") {
    const state = pos[0];
    if (state !== "on" && state !== "off") throw new UsageError("Usage: pcx audit set on|off --env NAME --table T [--table T2]... [--column C]... --reason TEXT");
    const tables = o.table ?? [];
    if (!tables.length) throw new UsageError("Name at least one --table");
    if (o.column?.length && tables.length > 1) throw new UsageError("Use one --table when naming columns");
    const changes = o.column?.length ? o.column.map((col) => ({ table: tables[0]!, column: col, on: state === "on" })) : tables.map((t) => ({ table: t, on: state === "on" }));
    const actor = await whoAmI(client).then((x) => x.user, () => undefined);
    const results = await setAudit(client, changes, o.reason, actor, "cli");
    for (const r of results) out(`${r.ok ? c.green("✓") : c.red("✗")} ${r.column ? `${r.table}.${r.column}` : r.table} → ${r.on ? "on" : "off"}${r.error ? c.red(` — ${r.error}`) : ""}`);
    return results.every((r) => r.ok) ? 0 : 1;
  }
  throw new UsageError("Usage: pcx audit status|tables|columns|log|set --env NAME");
}

async function cmdUserSettings(sub: string | undefined, o: Opts, config: PcxConfig): Promise<number> {
  const env = oneEnv(config, o);
  const client = new Workspace(config).client(env);
  const scope: UserScope = o.role ? { kind: "role", name: o.role } : o.team ? { kind: "team", name: o.team } : o.bu ? { kind: "businessunit", name: o.bu } : { kind: "all" };
  if (sub === "show") {
    const users = await listUserSettings(client, scope);
    if (o.json) return out(JSON.stringify(users, null, 2)), 0;
    out(
      table(
        ["USER", "LOCALE", "DATE", "TIME", "TIME ZONE", "PAGE", "OWN CHANGES"],
        users.map((u) => [u.name, String(u.settings.localeid ?? ""), u.settings.dateformatstring ?? "", u.settings.timeformatstring ?? "", String(u.settings.timezonecode ?? ""), String(u.settings.paginglimit ?? ""), u.onDefaults ? "" : "yes"])
      )
    );
    return 0;
  }
  if (sub !== "apply") throw new UsageError("Usage: pcx usersettings show|apply --env NAME [--role R | --team T | --bu B]");
  const region = o.region ? REGIONS[o.region] : undefined;
  if (o.region && !region) throw new UsageError(`Unknown --region. Choose: ${Object.keys(REGIONS).join(", ")}`);
  const regionSettings: Record<string, unknown> = { ...(region ?? {}) };
  delete regionSettings.label;
  const target = validateSettings({
    ...regionSettings,
    ...(o["date-format"] ? { dateformatstring: o["date-format"] } : {}),
    ...(o["time-format"] ? { timeformatstring: o["time-format"] } : {}),
    ...(o.timezone ? { timezonecode: Number(o.timezone) } : {}),
    ...(o.language ? { uilanguageid: Number(o.language), helplanguageid: Number(o.language) } : {}),
    ...(o.paging ? { paginglimit: Number(o.paging) } : {})
  });
  if (!Object.keys(target).length) throw new UsageError("Give at least one of --region, --date-format, --time-format, --timezone, --language, --paging");
  const plan = planApply(await listUserSettings(client, scope, target), target, !!o.overwrite);
  out(`${plan.users.length} users in scope · ${c.bold(String(plan.toChange.length))} to change · ${plan.alreadyMatching} already match · ${plan.skippedPersonalised} kept because they changed their own settings (--overwrite to include them)`);
  if (o["dry-run"]) {
    plan.toChange.slice(0, 50).forEach((u) => out(`  ${u.name} ${c.dim(u.login)}`));
    return 0;
  }
  checkPolicy(env, o.reason);
  if (env.managed && plan.toChange.length > 1 && !o.yes) {
    out(c.yellow(`Re-run with --yes to change ${plan.toChange.length} users in ${env.name}.`));
    return 2;
  }
  const actor = await whoAmI(client).then((x) => x.user, () => undefined);
  const res = await applyUserSettings(client, plan, { setOrgDefaults: !!o["new-users"], reason: o.reason, actor, source: "cli" });
  out(`${c.green("✓")} ${res.changed} users updated${res.orgDefaultsUpdated ? ", and set as the default for new users" : ""}`);
  for (const f of res.failed) out(c.red(`✗ ${f.name}: ${f.error}`));
  return res.failed.length ? 1 : 0;
}

// ---- cross-environment helpers for the CLI

function matrixTable(envNames: string[], rows: { label: string; cells: Record<string, string> }[], firstHeader: string): string {
  return table([firstHeader, ...envNames], rows.map((r) => [r.label, ...envNames.map((e) => r.cells[e] ?? c.dim("—"))]));
}

async function cmdComponentsMatrix(kind: ComponentKind, o: Opts, config: PcxConfig): Promise<number> {
  const ws = new Workspace(config);
  const res = await acrossEnvs(ws, envsFrom(config), (client) => listComponents(client, kind, { includeSystem: !!o["include-system"] }));
  const names = res.environments.filter((n) => res.results[n]);
  const rows = matrix(res.results, names, (i) => i.id.toLowerCase(), (i) => ({ name: i.name, custom: i.custom }));
  rows.sort((a, b) => a.name.localeCompare(b.name));
  const shown = o.off ? rows.filter((r) => names.some((n) => r.cells[n] && !r.cells[n]!.on)) : rows;
  if (o.json) return out(JSON.stringify({ environments: names, rows: shown, errors: res.errors }, null, 2)), 0;
  out(matrixTable(names, shown.map((r) => ({ label: r.name, cells: Object.fromEntries(names.map((n) => [n, r.cells[n] ? (r.cells[n]!.on ? c.green("on") : c.yellow("off")) : c.dim("—")])) })), NOUN[kind].toUpperCase()));
  for (const [e, m] of Object.entries(res.errors)) out(c.red(`${e}: ${m}`));
  return Object.keys(res.errors).length ? 1 : 0;
}

async function cmdAlerts(sub: string | undefined, o: Opts, config: PcxConfig, configPath: string): Promise<number> {
  const ws = new Workspace(config);
  if (sub === "schedule") {
    const every = Number(o.every ?? 60);
    if (!Number.isInteger(every) || every < 15 || every > 1440) throw new UsageError("--every must be 15-1440 minutes");
    const node = process.execPath;
    const cli = fileURLToPath(import.meta.url);
    const tr = `"${node}" "${cli}" alerts run --post --config "${configPath}"`;
    const args = ["/Create", "/SC", "MINUTE", "/MO", String(every), "/TN", "Env Console alerts", "/TR", tr, "/F"];
    if (process.platform !== "win32") {
      out(`Add this to your crontab (crontab -e) to check every ${every} minutes:\n\n  */${Math.min(every, 59)} * * * * ${tr.replace(/"/g, "'")}`);
      return 0;
    }
    if (!o.install) {
      out(`This creates a Windows scheduled task that checks every ${every} minutes and posts new alerts to Teams:\n\n  schtasks ${args.map((a) => (a.includes(" ") ? `"${a.replace(/"/g, '\\"')}"` : a)).join(" ")}\n\nRun again with --install to create it.`);
      return 0;
    }
    const r = await runProcess("schtasks", args);
    if (r.code !== 0) throw new Error(`schtasks failed: ${r.stderr || r.stdout}`);
    out(`${c.green("✓")} Scheduled "Env Console alerts" every ${every} minutes. It runs while you are signed in to Windows.`);
    return 0;
  }
  if (sub !== "list" && sub !== "run") throw new UsageError("Usage: pcx alerts list [--json] | pcx alerts run [--post] [--all] | pcx alerts schedule [--every 60] [--install]");
  const alerts = await evaluateAlerts(ws, envsFrom(config), sinceDate(o.since ?? "24h"));
  if (o.json) return out(JSON.stringify(alerts, null, 2)), 0;
  const sevColor = { critical: c.red, warning: c.yellow, info: c.blue };
  if (!alerts.length) out(c.green("No alerts."));
  else out(table(["SEVERITY", "ENV", "ALERT", "DETAIL"], alerts.map((a) => [sevColor[a.severity](a.severity), a.env, a.title, (a.detail ?? "").slice(0, 80)])));
  if (sub === "run" && o.post) {
    const hook = config.alerts?.teamsWebhook;
    if (!hook) throw new UsageError("No Teams webhook set. Run: pcx config set teams-webhook <url>");
    const toPost = o.all ? alerts : newAlerts(alerts);
    if (toPost.length) {
      await postToTeams(hook, toPost);
      rememberPosted(toPost);
      out(`${c.green("✓")} Posted ${toPost.length} alert${toPost.length === 1 ? "" : "s"} to Teams`);
    } else out(c.dim("Nothing new to post."));
  }
  return alerts.some((a) => a.severity === "critical") ? 1 : 0;
}

async function cmdReport(o: Opts, config: PcxConfig): Promise<number> {
  const days = Number(o.days ?? 7);
  if (!Number.isInteger(days) || days < 1 || days > 30) throw new UsageError("--days must be 1-30");
  const format = o.format ?? "html";
  if (!["html", "csv", "json"].includes(format)) throw new UsageError("--format must be html, csv or json");
  const report = await buildReport(new Workspace(config), config, days);
  const body = format === "csv" ? renderReportCsv(report) : format === "json" ? JSON.stringify(report, null, 2) : renderReportHtml(report);
  const file = o.out ?? `env-health-${report.generatedAt.slice(0, 10)}.${format}`;
  writeFileSync(file, body);
  out(`${c.green("✓")} Report saved to ${file}`);
  return 0;
}

async function cmdJobs(sub: string | undefined, pos: string[], o: Opts, config: PcxConfig): Promise<number> {
  const ws = new Workspace(config);
  if (sub === "list") {
    const since = sinceDate(o.since ?? "7d");
    const res = await acrossEnvs(ws, envsFrom(config, o.env), (client) => listProblemJobs(client, since));
    if (o.json) return out(JSON.stringify(res, null, 2)), 0;
    const rows = Object.entries(res.results).flatMap(([env, jobs]) => jobs.map((j) => ({ env, ...j })));
    rows.sort((a, b) => b.created.localeCompare(a.created));
    out(table(["ENV", "PROBLEM", "JOB", "TYPE", "CREATED", "MESSAGE", "ID"], rows.slice(0, 100).map((j) => [j.env, j.problem === "failed" ? c.red(j.problem) : c.yellow(j.problem), j.name, j.type, j.created.replace("T", " ").slice(0, 16), (j.message ?? "").split("\n")[0]!.slice(0, 60), c.dim(j.id)])));
    for (const [e, m] of Object.entries(res.errors)) out(c.red(`${e}: ${m}`));
    return 0;
  }
  if (sub !== "cancel" && sub !== "resume") throw new UsageError("Usage: pcx jobs list [--env NAME] [--since 7d] | pcx jobs cancel|resume --env NAME <job-id>... --reason TEXT");
  const env = oneEnv(config, o);
  const client = ws.client(env);
  if (!pos.length) throw new UsageError("Give one or more job IDs (from pcx jobs list)");
  const known = new Map((await listProblemJobs(client, sinceDate("30d"))).map((j) => [j.id.toLowerCase(), j]));
  const jobs = pos.map((id) => {
    const j = known.get(id.toLowerCase());
    if (!j) throw new UsageError(`Job ${id} is not waiting, suspended or failed in ${env.name}`);
    return { id: j.id, name: j.name };
  });
  const actor = await whoAmI(client).then((x) => x.user, () => undefined);
  const results = await changeJobs(client, jobs, sub, { reason: o.reason, actor, source: "cli" });
  for (const r of results) out(`${r.ok ? c.green("✓") : c.red("✗")} ${r.name}${r.error ? c.red(` — ${r.error}`) : ""}`);
  return results.every((r) => r.ok) ? 0 : 1;
}

async function cmdSecurity(sub: string | undefined, o: Opts, config: PcxConfig): Promise<number> {
  const ws = new Workspace(config);
  if (sub === "users") {
    const res = await acrossEnvs(ws, envsFrom(config), (client) => listUserRoles(client));
    const names = res.environments.filter((n) => res.results[n]);
    let rows = matrix(res.results, names, (u) => u.login, (u) => ({ name: u.name, login: u.login }));
    const cell = (u: { roles: string[] } | null) => (u ? u.roles.join(", ") || "(no roles)" : "—");
    if (o["diff-only"]) rows = rows.filter((r) => new Set(names.map((n) => cell(r.cells[n] ?? null))).size > 1);
    rows.sort((a, b) => a.name.localeCompare(b.name));
    if (o.json) return out(JSON.stringify({ environments: names, rows, errors: res.errors }, null, 2)), 0;
    out(matrixTable(names, rows.map((r) => ({ label: `${r.name} ${c.dim(r.login)}`, cells: Object.fromEntries(names.map((n) => [n, cell(r.cells[n] ?? null)])) })), "USER"));
    return 0;
  }
  if (sub === "roles") {
    const res = await acrossEnvs(ws, envsFrom(config), (client) => listRoles(client));
    const names = res.environments.filter((n) => res.results[n]);
    const rows = matrix(res.results, names, (r) => r.name, (r) => ({ name: r.name })).sort((a, b) => a.name.localeCompare(b.name));
    if (o.json) return out(JSON.stringify({ environments: names, rows, errors: res.errors }, null, 2)), 0;
    out(matrixTable(names, rows.map((r) => ({ label: r.name, cells: Object.fromEntries(names.map((n) => [n, r.cells[n] ? `${r.cells[n]!.users} users` : c.dim("missing")])) })), "ROLE"));
    return 0;
  }
  throw new UsageError("Usage: pcx security users [--diff-only] [--json] | pcx security roles [--json]");
}

async function cmdVars(sub: string | undefined, pos: string[], o: Opts, config: PcxConfig): Promise<number> {
  const ws = new Workspace(config);
  if (sub === "list") {
    const res = await acrossEnvs(ws, envsFrom(config), (client) => listEnvVars(client));
    const names = res.environments.filter((n) => res.results[n]);
    const rows = matrix(res.results, names, (v) => v.schemaName, (v) => ({ name: v.schemaName })).sort((a, b) => a.name.localeCompare(b.name));
    if (o.json) return out(JSON.stringify({ environments: names, rows, errors: res.errors }, null, 2)), 0;
    out(matrixTable(names, rows.map((r) => ({ label: r.name, cells: Object.fromEntries(names.map((n) => {
      const v = r.cells[n];
      return [n, !v ? c.dim("—") : v.secret ? c.dim("(secret)") : v.missing ? c.red("NO VALUE") : `${(v.effective ?? "").slice(0, 40)}${v.currentValue ? "" : c.dim(" (default)")}`];
    })) })), "VARIABLE"));
    return 0;
  }
  if (sub === "set") {
    const env = oneEnv(config, o);
    const [name, value] = pos;
    if (!name || value === undefined) throw new UsageError("Usage: pcx vars set --env NAME <schemaname> <value> --reason TEXT");
    const client = ws.client(env);
    const actor = await whoAmI(client).then((x) => x.user, () => undefined);
    await setEnvVarValue(client, name, value, { reason: o.reason, actor, source: "cli" });
    out(`${c.green("✓")} ${name} set in ${env.name}`);
    return 0;
  }
  throw new UsageError("Usage: pcx vars list [--json] | pcx vars set --env NAME <schemaname> <value> --reason TEXT");
}

async function cmdConnections(o: Opts, config: PcxConfig): Promise<number> {
  const res = await acrossEnvs(new Workspace(config), envsFrom(config), (client) => listConnectionRefs(client));
  const names = res.environments.filter((n) => res.results[n]);
  const rows = matrix(res.results, names, (r) => r.logicalName, (r) => ({ name: r.displayName, connector: r.connector })).sort((a, b) => a.name.localeCompare(b.name));
  if (o.json) return out(JSON.stringify({ environments: names, rows, errors: res.errors }, null, 2)), 0;
  out(matrixTable(names, rows.map((r) => ({ label: `${r.name} ${c.dim(r.connector)}`, cells: Object.fromEntries(names.map((n) => [n, !r.cells[n] ? c.dim("—") : r.cells[n]!.connected ? c.green("connected") : c.red("NOT CONNECTED")])) })), "CONNECTION REFERENCE"));
  return rows.some((r) => names.some((n) => r.cells[n] && !r.cells[n]!.connected)) ? 1 : 0;
}

function cmdConfig(sub: string | undefined, pos: string[], config: PcxConfig, configPath: string): number {
  if (sub === "path") return out(configPath), 0;
  if (sub === "set") {
    const [key, value] = pos;
    if (key === "tenant") {
      const next: PcxConfig = { ...config };
      if (value) next.tenantId = value;
      else delete next.tenantId;
      saveConfig(next, configPath);
      out(`${c.green("✓")} Tenant ${value ? `set to ${value}` : "cleared (your default tenant is used)"}`);
      return 0;
    }
    if (key === "teams-webhook") {
      const next: PcxConfig = { ...config };
      if (value) next.alerts = { teamsWebhook: validateWebhook(value) };
      else delete next.alerts;
      saveConfig(next, configPath);
      out(`${c.green("✓")} Teams webhook ${value ? "saved" : "removed"}`);
      return 0;
    }
    if (key === "provider" && (value === "azps" || value === "azcli")) {
      saveConfig({ ...config, auth: { provider: value } }, configPath);
      out(`${c.green("✓")} Sign-in provider set to ${value}`);
      return 0;
    }
  }
  throw new UsageError("Usage: pcx config path | pcx config set tenant <id-or-domain> | pcx config set provider azps|azcli");
}

/** Opens a URL in the default browser without going through a shell. */
function openBrowser(url: string): void {
  const [cmd, args] =
    process.platform === "win32" ? ["rundll32", ["url.dll,FileProtocolHandler", url]] : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
  try {
    spawn(cmd as string, args as string[], { stdio: "ignore", detached: true })
      .on("error", () => out(c.dim("Could not open a browser; copy the link above.")))
      .unref();
  } catch {
    out(c.dim("Could not open a browser; copy the link above."));
  }
}

export async function main(argv: string[]): Promise<number> {
  let parsed;
  try {
    parsed = opts(argv);
  } catch (e) {
    process.stderr.write(`${(e as Error).message}\n\n${HELP}\n`);
    return 2;
  }
  const { values: o, positionals } = parsed;
  if (o.version) return out(VERSION), 0;
  const [cmd, sub, ...rest] = positionals;
  if (!cmd || o.help || cmd === "help") return out(HELP), 0;
  if (o.config) process.env.PCX_CONFIG = o.config;
  const configPath = defaultConfigPath();
  try {
    const config = loadConfig(configPath);
    switch (cmd) {
      case "auth":
        return await cmdAuth(sub, o, config);
      case "env":
        return await cmdEnv(sub, rest, o, config, configPath);
      case "solution":
      case "solutions":
        return await cmdSolution(sub, rest, o, config);
      case "runs":
        return await cmdRuns(sub, o, config);
      case "audit":
        return await cmdAudit(sub, rest, o, config);
      case "usersettings":
        return await cmdUserSettings(sub, o, config);
      case "alerts":
        return await cmdAlerts(sub, o, config, configPath);
      case "report":
        return await cmdReport(o, config);
      case "jobs":
        return await cmdJobs(sub, rest, o, config);
      case "security":
        return await cmdSecurity(sub, o, config);
      case "vars":
        return await cmdVars(sub, rest, o, config);
      case "connections":
        return await cmdConnections(o, config);
      case "flows":
      case "rules":
      case "plugins":
        return await cmdComponents(cmd, sub, rest, o, config);
      case "serve": {
        if (process.env.PCX_MODE === "hosted") return await serveHosted(config);
        const port = o.port ? Number(o.port) : 4820;
        if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new UsageError("--port must be 1024-65535");
        const s = await startServer({ config, port, account: { provider: createProvider(config.auth.provider), save: (next) => saveConfig(next, configPath), configPath } });
        out(`Dashboard running. Open this link (it carries a one-time key):\n\n  ${c.bold(s.url)}\n\nPress Ctrl+C to stop.`);
        if (o.open) openBrowser(s.url);
        return await new Promise<number>(() => {});
      }
      case "config":
        return cmdConfig(sub, rest, config, configPath);
      default:
        throw new UsageError(`Unknown command: ${cmd}\n\n${HELP}`);
    }
  } catch (e) {
    process.stderr.write(c.red((e as Error).message) + "\n");
    return e instanceof UsageError ? 2 : 1;
  }
}

function isEntry(): boolean {
  try {
    return !!process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}
if (isEntry()) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
