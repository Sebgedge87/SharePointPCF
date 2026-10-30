import type { EnvConfig } from "./config.js";
import type { TokenSource } from "./auth.js";

export class DataverseError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string
  ) {
    super(message);
  }
}

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<{
  status: number;
  ok: boolean;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}>;

export interface ClientOptions {
  fetchImpl?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  maxRetries?: number;
}

const API = "/api/data/v9.2/";

/** Thin Dataverse Web API client for one environment. */
export class DataverseClient {
  private readonly fetchImpl: FetchLike;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly maxRetries: number;

  constructor(
    readonly env: EnvConfig,
    private readonly tokens: TokenSource,
    opts: ClientOptions = {}
  ) {
    this.fetchImpl = opts.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.maxRetries = opts.maxRetries ?? 4;
  }

  /** Builds an absolute URL for a relative API path, refusing anything that could leave this environment. */
  url(path: string): string {
    if (/^[a-z]+:/i.test(path) || path.startsWith("/") || path.includes("..") || path.includes("\\")) {
      throw new Error(`Refusing unsafe API path: ${path}`);
    }
    return this.env.url + API + path;
  }

  private sameEnv(absolute: string): boolean {
    try {
      const u = new URL(absolute);
      return u.origin === this.env.url && u.pathname.startsWith(API);
    } catch {
      return false;
    }
  }

  async requestAbsolute<T>(method: string, absolute: string, body?: unknown, extraHeaders: Record<string, string> = {}): Promise<T> {
    if (!this.sameEnv(absolute)) throw new Error(`Refusing to send a token outside ${this.env.url}`);
    let attempt = 0;
    for (;;) {
      const token = await this.tokens.token(this.env.url);
      const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "OData-MaxVersion": "4.0",
        "OData-Version": "4.0",
        Prefer: 'odata.include-annotations="OData.Community.Display.V1.FormattedValue",odata.maxpagesize=500',
        ...extraHeaders
      };
      const init: { method: string; headers: Record<string, string>; body?: string } = { method, headers };
      if (body !== undefined) {
        headers["Content-Type"] = "application/json; charset=utf-8";
        init.body = JSON.stringify(body);
      }
      const res = await this.fetchImpl(absolute, init);
      if ((res.status === 429 || res.status === 503 || res.status === 502) && attempt < this.maxRetries) {
        const ra = Number(res.headers.get("Retry-After"));
        const wait = Number.isFinite(ra) && ra > 0 ? Math.min(ra, 60) * 1000 : 1000 * 2 ** attempt;
        attempt++;
        await this.sleep(wait);
        continue;
      }
      const text = await res.text();
      if (!res.ok) {
        let message = `HTTP ${res.status}`;
        let code: string | undefined;
        try {
          const j = JSON.parse(text) as { error?: { message?: string; code?: string } };
          if (j.error?.message) message = j.error.message;
          code = j.error?.code;
        } catch {
          if (text) message += `: ${text.slice(0, 200)}`;
        }
        throw new DataverseError(`${this.env.name}: ${message}`, res.status, code);
      }
      if (!text) return undefined as T;
      return JSON.parse(text) as T;
    }
  }

  request<T>(method: string, path: string, body?: unknown, headers?: Record<string, string>): Promise<T> {
    return this.requestAbsolute<T>(method, this.url(path), body, headers);
  }

  get<T>(path: string): Promise<T> {
    return this.request<T>("GET", path);
  }

  /** Follows @odata.nextLink until all rows are read (or `max` is reached). */
  async getAll<T>(path: string, max = 20_000): Promise<T[]> {
    const rows: T[] = [];
    let next: string | undefined = this.url(path);
    while (next && rows.length < max) {
      const page: { value?: T[]; "@odata.nextLink"?: string } = await this.requestAbsolute("GET", next);
      rows.push(...(page.value ?? []));
      next = page["@odata.nextLink"];
    }
    return rows.slice(0, max);
  }

  /** Updates an existing row. If-Match: * stops PATCH from creating a row when the ID is wrong. */
  async update(entitySet: string, id: string, body: Record<string, unknown>): Promise<void> {
    if (!/^[a-z_]+$/i.test(entitySet)) throw new Error(`Bad entity set: ${entitySet}`);
    assertGuid(id);
    return this.request<void>("PATCH", `${entitySet}(${id})`, body, { "If-Match": "*" });
  }
}

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isGuid(s: string): boolean {
  return GUID_RE.test(s);
}

export function assertGuid(s: string): void {
  if (!isGuid(s)) throw new Error(`Not a valid ID: ${s}`);
}

/** Escapes a value for use inside an OData string literal. */
export function odataString(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}
