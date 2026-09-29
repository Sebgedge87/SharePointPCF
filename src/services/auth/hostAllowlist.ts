import { AppError } from "../../utils/errors";

/**
 * Tokens are only ever sent to SharePoint Online and Microsoft Graph.
 * Every URL that is configured (siteUrl, folderUrlOverride) or resolved
 * (document locations, render data) is checked here before a call is made.
 */
const GRAPH_HOST = "graph.microsoft.com";
const SHAREPOINT_SUFFIX = ".sharepoint.com";

export function parseUrl(url: string): URL | undefined {
    try {
        return new URL(url);
    } catch {
        return undefined;
    }
}

export function isSharePointHost(hostname: string): boolean {
    const host = hostname.toLowerCase();
    if (!host.endsWith(SHAREPOINT_SUFFIX)) return false;
    const tenantLabel = host.slice(0, -SHAREPOINT_SUFFIX.length);
    // exactly one label before .sharepoint.com: "contoso" or "contoso-my"
    return /^[a-z0-9][a-z0-9-]*$/.test(tenantLabel);
}

export function isAllowedUrl(url: string): boolean {
    const u = parseUrl(url);
    if (!u) return false;
    if (u.protocol !== "https:") return false;
    if (u.username || u.password) return false;
    if (u.port && u.port !== "443") return false;
    const host = u.hostname.toLowerCase();
    return host === GRAPH_HOST || isSharePointHost(host);
}

export function assertAllowedUrl(url: string, what = "URL"): URL {
    if (!isAllowedUrl(url)) {
        throw new AppError(
            "host-not-allowed",
            `${what} is not an allowed host. Only https://*.sharepoint.com and https://graph.microsoft.com are permitted.`,
        );
    }
    return new URL(url);
}

export function assertSharePointUrl(url: string, what = "SharePoint URL"): URL {
    const u = assertAllowedUrl(url, what);
    if (!isSharePointHost(u.hostname)) {
        throw new AppError("host-not-allowed", `${what} must be on *.sharepoint.com.`);
    }
    return u;
}

/** `https://contoso.sharepoint.com/.default`: the resource scope for a SharePoint host. */
export function sharePointScopeFor(url: string): string {
    const u = assertSharePointUrl(url);
    return `https://${u.hostname.toLowerCase()}/.default`;
}

export const GRAPH_TERMSTORE_SCOPE = "https://graph.microsoft.com/TermStore.Read.All";
