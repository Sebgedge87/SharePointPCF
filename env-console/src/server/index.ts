import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { findEnv, type PcxConfig } from "../core/config.js";
import { readActions } from "../core/actionLog.js";
import { AuthError } from "../core/auth.js";
import { changeState, listComponents, PolicyError, type ComponentKind } from "../core/components.js";
import { envStatus, whoAmI, Workspace } from "../core/environments.js";
import { buildMatrix, listSolutions, publisherCounts, type Solution } from "../core/solutions.js";
import { isGuid, type ClientOptions } from "../core/dataverse.js";
import { compareSolution, diffComponent } from "../core/compare.js";
import { runReport, setTraceSetting, type TraceSetting } from "../core/runs.js";
import { getSystemAudit, listAuditEntries, listColumnAudit, listTableAudit, setAudit, setSystemAudit } from "../core/audit.js";
import { applyUserSettings, LANGUAGES, listUserSettings, planApply, REGIONS, TIME_ZONES, validateSettings, type FormatSettings, type UserScope } from "../core/usersettings.js";
import { sinceDate } from "../core/util.js";
import type { HostedAuth, Session } from "./hosted.js";

const PUBLIC_DIR = fileURLToPath(new URL("../../../public/", import.meta.url));
const STATIC: Record<string, { file: string; type: string }> = {
  "/": { file: "index.html", type: "text/html; charset=utf-8" },
  "/index.html": { file: "index.html", type: "text/html; charset=utf-8" },
  "/app.js": { file: "app.js", type: "text/javascript; charset=utf-8" },
  "/app.css": { file: "app.css", type: "text/css; charset=utf-8" }
};

const SECURITY_HEADERS: Record<string, string> = {
  "Content-Security-Policy": "default-src 'none'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store"
};

export type ServerMode =
  /** Runs on one person's machine; API calls carry a one-time key; tokens come from PowerShell/Azure CLI. */
  | { kind: "local"; key?: string; workspace?: Workspace }
  /** Hosted for a team; everyone signs in with Entra ID and Dataverse is called as them. */
  | { kind: "hosted"; auth: HostedAuth; clientOptions?: ClientOptions };

export interface ServerOptions {
  config: PcxConfig;
  port: number;
  /** Defaults to local mode. */
  mode?: ServerMode;
  /** Address to listen on. Local mode always uses 127.0.0.1. */
  listenHost?: string;
  publicDir?: string;
  /** Kept for older callers and tests: same as mode {kind:"local", key, workspace}. */
  key?: string;
  workspace?: Workspace;
}

export interface RunningServer {
  url: string;
  port: number;
  /** Local mode only. */
  key: string;
  server: Server;
  close(): Promise<void>;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly extra: Record<string, unknown> = {}
  ) {
    super(message);
  }
}

const KINDS = new Set<ComponentKind>(["flow", "rule", "plugin"]);

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { ...SECURITY_HEADERS, "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  if (!(req.headers["content-type"] ?? "").startsWith("application/json")) throw new HttpError(415, "Expected JSON");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 64 * 1024) throw new HttpError(413, "Request too large");
    chunks.push(chunk as Buffer);
  }
  try {
    const v = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
    if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error();
    return v as Record<string, unknown>;
  } catch {
    throw new HttpError(400, "Invalid JSON");
  }
}

function keyMatches(given: string | string[] | undefined, key: string): boolean {
  if (typeof given !== "string") return false;
  const a = Buffer.from(given);
  const b = Buffer.from(key);
  return a.length === b.length && timingSafeEqual(a, b);
}

interface Caller {
  ws: Workspace;
  /** Known up front in hosted mode; looked up with WhoAmI in local mode. */
  user?: string;
  name?: string;
}

export function startServer(opts: ServerOptions): Promise<RunningServer> {
  const mode: ServerMode = opts.mode ?? { kind: "local", key: opts.key, workspace: opts.workspace };
  const cfg = opts.config;
  const publicDir = opts.publicDir ?? PUBLIC_DIR;
  const localKey = mode.kind === "local" ? mode.key ?? randomBytes(24).toString("base64url") : "";
  const localWs = mode.kind === "local" ? mode.workspace ?? new Workspace(cfg) : undefined;
  const hostedWs = new WeakMap<Session, Workspace>();
  let port = opts.port;

  const allowedHosts = (): string[] => (mode.kind === "hosted" ? [new URL(mode.auth.settings.publicUrl).host] : [`127.0.0.1:${port}`, `localhost:${port}`]);
  const allowedOrigins = (): string[] => (mode.kind === "hosted" ? [mode.auth.settings.publicUrl] : [`http://127.0.0.1:${port}`, `http://localhost:${port}`]);

  /** Works out who is calling, or refuses. */
  const caller = (req: IncomingMessage): Caller => {
    if (mode.kind === "local") {
      if (!keyMatches(req.headers["x-pcx-key"], localKey)) throw new HttpError(401, "Missing or wrong dashboard key. Open the link printed by pcx serve.");
      return { ws: localWs! };
    }
    // Custom header: a cross-site form or image request cannot add it.
    if (req.headers["x-pcx-request"] !== "1") throw new HttpError(403, "Missing request header");
    const s = mode.auth.session(req);
    if (!s) throw new HttpError(401, "Sign in to continue.", { login: "/auth/login" });
    let ws = hostedWs.get(s);
    if (!ws) {
      ws = new Workspace(cfg, mode.auth.tokensFor(s), mode.clientOptions);
      hostedWs.set(s, ws);
    }
    return { ws, user: s.user, name: s.name };
  };

  const api = async (req: IncomingMessage, url: URL, who: Caller): Promise<unknown> => {
    const { ws } = who;
    if (req.method === "GET" && url.pathname === "/api/config") {
      return {
        mode: mode.kind,
        provider: mode.kind === "hosted" ? "entra" : cfg.auth.provider,
        user: who.user,
        name: who.name,
        environments: cfg.environments.map((e) => ({ name: e.name, url: e.url, managed: e.managed }))
      };
    }
    if (req.method === "GET" && url.pathname === "/api/status") {
      return envStatus(ws, findEnv(cfg, url.searchParams.get("env") ?? ""), true);
    }
    if (req.method === "GET" && url.pathname === "/api/solutions") {
      const perEnv: Record<string, Solution[]> = {};
      const errors: Record<string, string> = {};
      await Promise.all(
        cfg.environments.map(async (e) => {
          try {
            perEnv[e.name] = await listSolutions(ws.client(e));
          } catch (err) {
            errors[e.name] = (err as Error).message;
          }
        })
      );
      const rows = buildMatrix(cfg.environments.map((e) => e.name), perEnv);
      return { environments: cfg.environments.map((e) => e.name), rows, publishers: publisherCounts(rows), errors };
    }
    if (req.method === "GET" && url.pathname === "/api/components") {
      const env = findEnv(cfg, url.searchParams.get("env") ?? "");
      const kind = url.searchParams.get("kind") as ComponentKind;
      if (!KINDS.has(kind)) throw new HttpError(400, "kind must be flow, rule or plugin");
      return { env: env.name, managed: env.managed, items: await listComponents(ws.client(env), kind, { includeSystem: url.searchParams.get("all") === "1" }) };
    }
    if (req.method === "POST" && url.pathname === "/api/components/state") {
      const body = await readJson(req);
      const env = findEnv(cfg, String(body.env ?? ""));
      const kind = body.kind as ComponentKind;
      if (!KINDS.has(kind)) throw new HttpError(400, "kind must be flow, rule or plugin");
      if (typeof body.on !== "boolean") throw new HttpError(400, "on must be true or false");
      const ids = body.ids;
      if (!Array.isArray(ids) || ids.length === 0 || ids.length > 500 || !ids.every((i) => typeof i === "string" && isGuid(i))) {
        throw new HttpError(400, "ids must be a list of component IDs");
      }
      const reason = typeof body.reason === "string" ? body.reason.slice(0, 500) : undefined;
      const client = ws.client(env);
      // Only act on IDs that really are components of this kind in this environment.
      const known = new Map((await listComponents(client, kind, { includeSystem: true })).map((c) => [c.id.toLowerCase(), c]));
      const items = (ids as string[]).map((id) => known.get(id.toLowerCase()));
      if (items.some((i) => !i)) throw new HttpError(400, `Some IDs are not ${kind} components in ${env.name}`);
      let actor = who.user;
      if (!actor) {
        try {
          actor = (await whoAmI(client)).user;
        } catch {
          /* logged without actor */
        }
      }
      const results = await changeState(client, { kind, items: items.map((i) => ({ id: i!.id, name: i!.name })), on: body.on, reason, actor, source: "dashboard" });
      return { results };
    }
    const q = (k: string) => url.searchParams.get(k) ?? "";
    const actorFor = async (client: ReturnType<Workspace["client"]>) => who.user ?? (await whoAmI(client).then((x) => x.user, () => undefined));
    const reasonOf = (b: Record<string, unknown>) => (typeof b.reason === "string" ? b.reason.slice(0, 500) : undefined);

    // ---- solution compare
    if (req.method === "GET" && url.pathname === "/api/compare") {
      const solution = q("solution");
      if (!/^[A-Za-z0-9_]{1,100}$/.test(solution)) throw new HttpError(400, "Choose a solution");
      return compareSolution(ws.client(findEnv(cfg, q("a"))), ws.client(findEnv(cfg, q("b"))), solution);
    }
    if (req.method === "GET" && url.pathname === "/api/compare/diff") {
      const type = Number(q("type"));
      if (!Number.isInteger(type) || !isGuid(q("id"))) throw new HttpError(400, "Bad component");
      return diffComponent(ws.client(findEnv(cfg, q("a"))), ws.client(findEnv(cfg, q("b"))), type, q("id"));
    }

    // ---- run history
    if (req.method === "GET" && url.pathname === "/api/runs") {
      const env = findEnv(cfg, q("env"));
      return runReport(ws.client(env), env, sinceDate(q("since") || "7d"));
    }
    if (req.method === "POST" && url.pathname === "/api/runs/trace") {
      const body = await readJson(req);
      const env = findEnv(cfg, String(body.env ?? ""));
      const setting = body.setting as TraceSetting;
      if (!["off", "exceptions", "all"].includes(setting)) throw new HttpError(400, "setting must be off, exceptions or all");
      const client = ws.client(env);
      await setTraceSetting(client, setting, reasonOf(body), await actorFor(client), "dashboard");
      return { ok: true };
    }

    // ---- audit
    if (req.method === "GET" && url.pathname === "/api/audit/system") return getSystemAudit(ws.client(findEnv(cfg, q("env"))));
    if (req.method === "POST" && url.pathname === "/api/audit/system") {
      const body = await readJson(req);
      const client = ws.client(findEnv(cfg, String(body.env ?? "")));
      const change: { auditEnabled?: boolean; userAccessAudit?: boolean } = {};
      if (typeof body.auditEnabled === "boolean") change.auditEnabled = body.auditEnabled;
      if (typeof body.userAccessAudit === "boolean") change.userAccessAudit = body.userAccessAudit;
      await setSystemAudit(client, change, reasonOf(body), await actorFor(client), "dashboard");
      return getSystemAudit(client);
    }
    if (req.method === "GET" && url.pathname === "/api/audit/tables") return { tables: await listTableAudit(ws.client(findEnv(cfg, q("env")))) };
    if (req.method === "GET" && url.pathname === "/api/audit/columns") return { columns: await listColumnAudit(ws.client(findEnv(cfg, q("env"))), q("table")) };
    if (req.method === "POST" && url.pathname === "/api/audit/set") {
      const body = await readJson(req);
      const client = ws.client(findEnv(cfg, String(body.env ?? "")));
      const changes = body.changes;
      if (!Array.isArray(changes) || changes.length === 0 || changes.length > 300) throw new HttpError(400, "changes must be a list of 1-300 items");
      const list = changes.map((c: Record<string, unknown>) => {
        if (typeof c.table !== "string" || typeof c.on !== "boolean" || (c.column !== undefined && typeof c.column !== "string")) throw new HttpError(400, "Each change needs table, on and optional column");
        return { table: c.table, column: c.column as string | undefined, on: c.on };
      });
      return { results: await setAudit(client, list, reasonOf(body), await actorFor(client), "dashboard") };
    }
    if (req.method === "GET" && url.pathname === "/api/audit/log") {
      return { entries: await listAuditEntries(ws.client(findEnv(cfg, q("env"))), q("table"), sinceDate(q("since") || "7d"), { column: q("column") || undefined }) };
    }

    // ---- user settings
    if (req.method === "GET" && url.pathname === "/api/usersettings/options") return { regions: REGIONS, timeZones: TIME_ZONES, languages: LANGUAGES };
    if (req.method === "POST" && (url.pathname === "/api/usersettings/preview" || url.pathname === "/api/usersettings/apply")) {
      const body = await readJson(req);
      const client = ws.client(findEnv(cfg, String(body.env ?? "")));
      const target = validateSettings((body.target ?? {}) as FormatSettings);
      if (Object.keys(target).length === 0) throw new HttpError(400, "Choose at least one setting");
      const sc = (body.scope ?? { kind: "all" }) as Record<string, unknown>;
      if (!["all", "role", "team", "businessunit"].includes(String(sc.kind)) || (sc.kind !== "all" && (typeof sc.name !== "string" || !sc.name))) throw new HttpError(400, "Bad scope");
      const scope = (sc.kind === "all" ? { kind: "all" } : { kind: sc.kind, name: sc.name }) as UserScope;
      const plan = planApply(await listUserSettings(client, scope, target), target, body.overwrite === true);
      if (url.pathname.endsWith("/preview")) {
        return { inScope: plan.users.length, toChange: plan.toChange.length, skippedPersonalised: plan.skippedPersonalised, alreadyMatching: plan.alreadyMatching, sample: plan.toChange.slice(0, 200).map((u) => ({ name: u.name, login: u.login })) };
      }
      return applyUserSettings(client, plan, { setOrgDefaults: body.setOrgDefaults === true, reason: reasonOf(body), actor: await actorFor(client), source: "dashboard" });
    }

    if (req.method === "GET" && url.pathname === "/api/actions") {
      return { actions: readActions(200) };
    }
    throw new HttpError(404, "Not found");
  };

  const server = createServer((req, res) => {
    const handle = async () => {
      // Only answer requests addressed to the name we expect (blocks DNS rebinding).
      const host = req.headers.host ?? "";
      if (!allowedHosts().includes(host)) throw new HttpError(421, "Unexpected host");
      const url = new URL(req.url ?? "/", `http://${host}`);
      if (mode.kind === "hosted" && url.pathname.startsWith("/auth/")) {
        if (await mode.auth.route(req, res, url)) return;
      }
      if (url.pathname === "/healthz") {
        send(res, 200, { ok: true });
        return;
      }
      if (url.pathname.startsWith("/api/")) {
        const origin = req.headers.origin;
        if (req.method !== "GET" && origin && !allowedOrigins().includes(origin)) throw new HttpError(403, "Cross-site request refused");
        const who = caller(req);
        send(res, 200, await api(req, url, who));
        return;
      }
      const s = STATIC[url.pathname];
      if (!s || req.method !== "GET") throw new HttpError(404, "Not found");
      const headers: Record<string, string> = { ...SECURITY_HEADERS, "Content-Type": s.type };
      if (mode.kind === "hosted" && mode.auth.secure) headers["Strict-Transport-Security"] = "max-age=31536000";
      res.writeHead(200, headers);
      res.end(readFileSync(publicDir + s.file));
    };
    handle().catch((e: unknown) => {
      const err = e as Error;
      let status = 502;
      let extra: Record<string, unknown> = {};
      if (e instanceof HttpError) {
        status = e.status;
        extra = e.extra;
      } else if (e instanceof PolicyError) status = 400;
      else if (e instanceof AuthError && e.needsLogin && mode.kind === "hosted") {
        status = 401;
        extra = { login: "/auth/login" };
      } else if (/Unknown environment/.test(err.message)) status = 404;
      if (!res.headersSent) send(res, status, { error: err.message, ...extra });
      else res.end();
    });
  });

  const listenHost = mode.kind === "local" ? "127.0.0.1" : opts.listenHost ?? "0.0.0.0";
  return new Promise((resolveStart, reject) => {
    server.once("error", reject);
    server.listen(opts.port, listenHost, () => {
      port = (server.address() as AddressInfo).port;
      resolveStart({
        url: mode.kind === "hosted" ? `${mode.auth.settings.publicUrl}/` : `http://127.0.0.1:${port}/#key=${localKey}`,
        port,
        key: localKey,
        server,
        close: () => new Promise((r) => server.close(() => r()))
      });
    });
  });
}
