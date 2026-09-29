import { GRAPH_TERMSTORE_SCOPE, isSharePointHost, parseUrl, sharePointScopeFor } from "./hostAllowlist";
import { AppError } from "../../utils/errors";

/**
 * Separate token per resource: SharePoint REST gets the host's /.default
 * (whatever delegated SharePoint permission was consented: Sites.Selected
 * or AllSites.Write); Graph gets TermStore.Read.All only.
 */
export function scopeForUrl(url: string): string {
    const u = parseUrl(url);
    if (!u) throw new AppError("host-not-allowed", "Invalid URL.");
    if (u.hostname.toLowerCase() === "graph.microsoft.com") return GRAPH_TERMSTORE_SCOPE;
    if (isSharePointHost(u.hostname)) return sharePointScopeFor(url);
    throw new AppError("host-not-allowed", "No token scope for this host.");
}
