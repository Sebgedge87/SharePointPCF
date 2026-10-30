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
import { HostedAuth, loadHostedSettings } from "../server/hosted.js";
import { c, table } from "./format.js";

const VERSION = "0.1.0";

const HELP = `pcx ${VERSION} — Power Platform environment console

Sign-in
  pcx auth login [--device-code]        Sign in with PowerShell (Connect-AzAccount) or Azure CLI
  pcx auth status                       Check sign-in against every environment

Environments
  pcx env list [--json]                 Health, version, solutions, flows and plugin steps
  pcx env add <NAME> <URL> [--unmanaged]
  pcx env remove <NAME>

Solutions
  pcx solution list [--env NAME]... [--publisher P]... [--include-microsoft]
                    [--diff-only] [--search TEXT] [--json]

Flows, business rules and plugin steps
  pcx flows|rules|plugins list --env NAME [--off] [--json]
  pcx flows|rules|plugins on|off --env NAME (<name-or-id>... | --filter TEXT | --all)
                    [--reason TEXT] [--dry-run] [--yes]

Dashboard
  pcx serve [--port 4820] [--open]      Start the dashboard on this machine (--open opens the browser)

Other
  pcx config path                       Show which config file is used
  pcx config set tenant <id-or-domain>  Sign in to a specific tenant (empty to clear)
  pcx config set provider azps|azcli    Sign in with PowerShell (default) or Azure CLI

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
  if (sub === "remove") {
    const env = findEnv(config, pos[0] ?? "");
    saveConfig({ ...config, environments: config.environments.filter((e) => e !== env) }, configPath);
    out(`${c.green("✓")} Removed ${env.name}`);
    return 0;
  }
  throw new UsageError("Usage: pcx env list|add|remove");
}

async function cmdSolution(sub: string | undefined, o: Opts, config: PcxConfig): Promise<number> {
  if (sub !== "list") throw new UsageError("Usage: pcx solution list [options]");
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
  const env = oneEnv(config, o);
  const ws = new Workspace(config);
  const client = ws.client(env);
  const all = await listComponents(client, kind);
  if (sub === "list") {
    const rows = o.off ? all.filter((x) => !x.on) : all;
    if (o.json) return out(JSON.stringify(rows, null, 2)), 0;
    out(table(["STATE", "NAME", "TARGET", "ID"], rows.map((r) => [r.on ? c.green("on") : c.dim("off"), r.name, r.target, c.dim(r.id)])));
    out(c.dim(`${rows.length} ${NOUN[kind]}s in ${env.name}`));
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
        return await cmdSolution(sub, o, config);
      case "flows":
      case "rules":
      case "plugins":
        return await cmdComponents(cmd, sub, rest, o, config);
      case "serve": {
        if (process.env.PCX_MODE === "hosted") return await serveHosted(config);
        const port = o.port ? Number(o.port) : 4820;
        if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new UsageError("--port must be 1024-65535");
        const s = await startServer({ config, port });
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
