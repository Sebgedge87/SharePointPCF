import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { findEnv, type PcxConfig } from "../core/config.js";
import { readActions } from "../core/actionLog.js";
import { changeState, listComponents, PolicyError, type ComponentKind } from "../core/components.js";
import { envStatus, whoAmI, Workspace } from "../core/environments.js";
import { buildMatrix, listSolutions, publisherCounts, type Solution } from "../core/solutions.js";
import { isGuid } from "../core/dataverse.js";

const PUBLIC_DIR = fileURLToPath(new URL("../../../public/", import.meta.url));
const STATIC: Record<string, { file: string; type: string }> = {
  "/": { file: "index.html", type: "text/html; charset=utf-8" },
  "/index.html": { file: "index.html", type: "text/html; charset=utf-8" },
  "/app.js": { file: "app.js", type: "text/javascript; charset=utf-8" },
  "/app.css": { file: "app.css", type: "text/css; charset=utf-8" }
};

const SECURITY_HEADERS = {
  "Content-Security-Policy": "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store"
};

export interface ServerOptions {
  config: PcxConfig;
  port: number;
  workspace?: Workspace;
  /** Fixed key for tests; a random one otherwise. */
  key?: string;
  publicDir?: string;
}

export interface RunningServer {
  url: string;
  port: number;
  key: string;
  server: Server;
  close(): Promise<void>;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string
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

export function startServer(opts: ServerOptions): Promise<RunningServer> {
  const ws = opts.workspace ?? new Workspace(opts.config);
  const key = opts.key ?? randomBytes(24).toString("base64url");
  const publicDir = opts.publicDir ?? PUBLIC_DIR;
  let port = opts.port;

  const api = async (req: IncomingMessage, url: URL): Promise<unknown> => {
    const cfg = opts.config;
    if (req.method === "GET" && url.pathname === "/api/config") {
      return { provider: cfg.auth.provider, environments: cfg.environments.map((e) => ({ name: e.name, url: e.url, managed: e.managed })) };
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
      return { env: env.name, managed: env.managed, items: await listComponents(ws.client(env), kind) };
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
      const known = new Map((await listComponents(client, kind)).map((c) => [c.id.toLowerCase(), c]));
      const items = (ids as string[]).map((id) => known.get(id.toLowerCase()));
      if (items.some((i) => !i)) throw new HttpError(400, `Some IDs are not ${kind} components in ${env.name}`);
      let actor: string | undefined;
      try {
        actor = (await whoAmI(client)).user;
      } catch {
        /* logged without actor */
      }
      const results = await changeState(client, { kind, items: items.map((i) => ({ id: i!.id, name: i!.name })), on: body.on, reason, actor, source: "dashboard" });
      return { results };
    }
    if (req.method === "GET" && url.pathname === "/api/actions") {
      return { actions: readActions(100) };
    }
    throw new HttpError(404, "Not found");
  };

  const server = createServer((req, res) => {
    const handle = async () => {
      // Only answer requests addressed to this machine by name we expect (blocks DNS rebinding).
      const host = req.headers.host ?? "";
      if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) throw new HttpError(421, "Unexpected host");
      const url = new URL(req.url ?? "/", `http://${host}`);
      if (url.pathname.startsWith("/api/")) {
        if (!keyMatches(req.headers["x-pcx-key"], key)) throw new HttpError(401, "Missing or wrong dashboard key. Open the link printed by pcx serve.");
        const origin = req.headers.origin;
        if (req.method !== "GET" && origin && origin !== `http://127.0.0.1:${port}` && origin !== `http://localhost:${port}`) throw new HttpError(403, "Cross-site request refused");
        send(res, 200, await api(req, url));
        return;
      }
      const s = STATIC[url.pathname];
      if (!s || req.method !== "GET") throw new HttpError(404, "Not found");
      res.writeHead(200, { ...SECURITY_HEADERS, "Content-Type": s.type });
      res.end(readFileSync(publicDir + s.file));
    };
    handle().catch((e: unknown) => {
      const err = e as Error;
      const status = e instanceof HttpError ? e.status : e instanceof PolicyError ? 400 : /Unknown environment/.test(err.message) ? 404 : 502;
      if (!res.headersSent) send(res, status, { error: err.message });
      else res.end();
    });
  });

  return new Promise((resolveStart, reject) => {
    server.once("error", reject);
    server.listen(opts.port, "127.0.0.1", () => {
      port = (server.address() as AddressInfo).port;
      resolveStart({
        url: `http://127.0.0.1:${port}/#key=${key}`,
        port,
        key,
        server,
        close: () => new Promise((r) => server.close(() => r()))
      });
    });
  });
}
