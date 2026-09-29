import { AppError } from "../utils/errors";
import { fetchWithRetry, RetryOptions } from "../utils/retry";
import { assertAllowedUrl } from "./auth/hostAllowlist";
import { redact } from "./auth/redact";
import { TokenProvider } from "./auth/authService";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface HttpClientOptions {
    tokenProvider: TokenProvider;
    /** Maps a URL to the scope whose token it needs. */
    scopeFor: (url: string) => string;
    fetchImpl?: FetchLike;
    retry?: RetryOptions;
}

export interface RequestOptions {
    method?: string;
    headers?: Record<string, string>;
    body?: BodyInit | null;
    /** Treat 404 as a value rather than an error. */
    allow404?: boolean;
}

/** Pull a readable message out of SharePoint / Graph error bodies. */
export function extractErrorMessage(body: string): string | undefined {
    try {
        const json = JSON.parse(body);
        return (
            json?.error?.message?.value ??
            json?.["odata.error"]?.message?.value ??
            json?.error?.message ??
            json?.error_description ??
            undefined
        );
    } catch {
        return body ? body.slice(0, 300) : undefined;
    }
}

/**
 * Bearer-authenticated fetch. Every call is checked against the host
 * allowlist *before* a token is acquired, so a token is never minted for,
 * let alone sent to, a disallowed host.
 */
export class HttpClient {
    private readonly opts: HttpClientOptions;
    private readonly fetchImpl: FetchLike;

    constructor(opts: HttpClientOptions) {
        this.opts = opts;
        this.fetchImpl = opts.fetchImpl ?? ((i, init) => fetch(i, init));
    }

    async raw(url: string, options: RequestOptions = {}): Promise<Response> {
        assertAllowedUrl(url, "Request URL");
        const scope = this.opts.scopeFor(url);
        const doFetch = async () => {
            const token = await this.opts.tokenProvider(scope);
            try {
                return await this.fetchImpl(url, {
                    method: options.method ?? "GET",
                    headers: {
                        Accept: "application/json;odata=nometadata",
                        ...options.headers,
                        Authorization: `Bearer ${token}`,
                    },
                    body: options.body ?? undefined,
                    credentials: "omit",
                    mode: "cors",
                });
            } catch (e) {
                throw new AppError("network", `Network error calling ${new URL(url).hostname}: ${redact(e)}`);
            }
        };
        const res = await fetchWithRetry(doFetch, this.opts.retry);
        if (res.ok || (options.allow404 && res.status === 404)) return res;
        const text = await res.text().catch(() => "");
        const message = redact(extractErrorMessage(text) ?? res.statusText ?? "Request failed");
        switch (res.status) {
            case 401:
            case 403:
                throw new AppError("no-permission", `Access denied: ${message}`, res.status);
            case 404:
                throw new AppError("not-found", message, res.status);
            case 429:
            case 503:
                throw new AppError("throttled", "The service is busy (throttled). Try again shortly.", res.status);
            default:
                throw new AppError("http", `${res.status}: ${message}`, res.status);
        }
    }

    async json<T>(url: string, options: RequestOptions = {}): Promise<T> {
        const res = await this.raw(url, options);
        if (res.status === 204 || res.status === 404) return undefined as unknown as T;
        const text = await res.text();
        return (text ? JSON.parse(text) : undefined) as T;
    }
}
