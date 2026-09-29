import { HttpClient, RequestOptions } from "../httpClient";
import { assertSharePointUrl } from "../auth/hostAllowlist";
import { AppError } from "../../utils/errors";

/** OData string literal: 'O''Brien'. */
export function odataString(value: string): string {
    return `'${value.replace(/'/g, "''")}'`;
}

/**
 * Build a query string of parameter aliases (@a='...'). Using aliases keeps
 * paths containing #, %, & and quotes intact, which inline literals do not.
 */
export function aliasQuery(aliases: Record<string, string>, extra?: Record<string, string>): string {
    const parts = Object.entries(aliases).map(([k, v]) => `@${k}=${encodeURIComponent(odataString(v))}`);
    if (extra) {
        for (const [k, v] of Object.entries(extra)) parts.push(`${k}=${encodeURIComponent(v)}`);
    }
    return parts.length ? `?${parts.join("&")}` : "";
}

export function trimSlash(s: string): string {
    return s.replace(/\/+$/, "");
}

/** Web-relative REST wrapper for one SharePoint site (web). */
export class SharePointRest {
    readonly webUrl: string;
    readonly origin: string;
    /** e.g. /sites/crm */
    readonly webServerRelativeUrl: string;
    private readonly http: HttpClient;

    constructor(http: HttpClient, webUrl: string) {
        const u = assertSharePointUrl(webUrl, "Site URL");
        this.http = http;
        this.origin = u.origin;
        this.webServerRelativeUrl = trimSlash(decodeURIComponent(u.pathname)) || "";
        this.webUrl = `${u.origin}${trimSlash(u.pathname)}`;
    }

    url(apiPath: string): string {
        return `${this.webUrl}/_api/${apiPath.replace(/^\//, "")}`;
    }

    /** Absolute URL for a server-relative path on this host. */
    absolute(serverRelativeUrl: string): string {
        return `${this.origin}${serverRelativeUrl
            .split("/")
            .map((seg) => encodeURIComponent(seg))
            .join("/")}`;
    }

    get<T>(apiPath: string, options: RequestOptions = {}): Promise<T> {
        return this.http.json<T>(this.url(apiPath), options);
    }

    post<T>(apiPath: string, body?: unknown, options: RequestOptions = {}): Promise<T> {
        const isBinary =
            body instanceof ArrayBuffer || (typeof Blob !== "undefined" && body instanceof Blob) || ArrayBuffer.isView(body);
        return this.http.json<T>(this.url(apiPath), {
            ...options,
            method: "POST",
            headers: {
                ...(isBinary ? {} : { "Content-Type": "application/json;odata=nometadata" }),
                ...options.headers,
            },
            body:
                body === undefined
                    ? undefined
                    : isBinary
                      ? (body as BodyInit)
                      : JSON.stringify(body),
        });
    }

    /** GET an absolute URL returned by SharePoint (e.g. odata.nextLink). Must be on this site's host. */
    getAbsolute<T>(url: string, options: RequestOptions = {}): Promise<T> {
        const u = assertSharePointUrl(url, "Paging URL");
        if (u.origin.toLowerCase() !== this.origin.toLowerCase()) {
            throw new AppError("host-not-allowed", "Paging URL is not on the site's host.");
        }
        return this.http.json<T>(url, options);
    }

    raw(apiPath: string, options: RequestOptions = {}): Promise<Response> {
        return this.http.raw(this.url(apiPath), options);
    }
}
