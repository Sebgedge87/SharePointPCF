import { HttpClient } from "../httpClient";
import { SharePointRest } from "../sharepoint/spRest";
import { TermValue } from "../../model/values";
import { log } from "../auth/redact";

const GRAPH = "https://graph.microsoft.com/v1.0";

export interface TermNode extends TermValue {
    /** "Parent > Child" for display and search. */
    path: string;
}

interface GraphTerm {
    id: string;
    labels?: { name: string; languageTag?: string; isDefault?: boolean }[];
}

export interface StorageLike {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
}

export interface TermStoreOptions {
    /** Stop walking after this many terms (large sets: search what is loaded). */
    maxTerms?: number;
    maxDepth?: number;
    storage?: StorageLike;
}

function defaultLabel(t: GraphTerm): string {
    const labels = t.labels ?? [];
    return (labels.find((l) => l.isDefault) ?? labels[0])?.name ?? t.id;
}

function safeSessionStorage(): StorageLike | undefined {
    try {
        return typeof sessionStorage !== "undefined" ? sessionStorage : undefined;
    } catch {
        return undefined;
    }
}

/**
 * Graph term store client (TermStore.Read.All only). Terms of a set (or of
 * an anchor term) are walked breadth-first once and cached per session, in
 * memory and sessionStorage. The Graph site id is built from SharePoint REST
 * ids so no Graph Sites.* permission is needed.
 */
export class TermStoreClient {
    private readonly memory = new Map<string, Promise<TermNode[]>>();
    private siteIdPromise?: Promise<string>;
    private readonly opts: Required<Omit<TermStoreOptions, "storage">> & { storage?: StorageLike };

    constructor(
        private readonly http: HttpClient,
        private readonly sp: SharePointRest,
        opts: TermStoreOptions = {},
    ) {
        this.opts = { maxTerms: opts.maxTerms ?? 2000, maxDepth: opts.maxDepth ?? 6, storage: opts.storage ?? safeSessionStorage() };
    }

    /** "{hostname},{siteCollectionId},{webId}" */
    graphSiteId(): Promise<string> {
        if (!this.siteIdPromise) {
            this.siteIdPromise = Promise.all([this.sp.get<{ Id: string }>("site?$select=Id"), this.sp.get<{ Id: string }>("web?$select=Id")]).then(
                ([site, web]) => `${new URL(this.sp.webUrl).hostname},${site.Id},${web.Id}`,
            );
            this.siteIdPromise.catch(() => (this.siteIdPromise = undefined));
        }
        return this.siteIdPromise;
    }

    getTerms(termSetId: string, anchorId?: string): Promise<TermNode[]> {
        const key = `spmg.terms.${termSetId}.${anchorId ?? ""}`.toLowerCase();
        let p = this.memory.get(key);
        if (!p) {
            p = this.loadCached(key, termSetId, anchorId);
            this.memory.set(key, p);
            p.catch(() => this.memory.delete(key));
        }
        return p;
    }

    private async loadCached(key: string, termSetId: string, anchorId?: string): Promise<TermNode[]> {
        const cached = this.opts.storage?.getItem(key);
        if (cached) {
            try {
                return JSON.parse(cached) as TermNode[];
            } catch {
                // fall through and reload
            }
        }
        const terms = await this.walk(termSetId, anchorId);
        try {
            this.opts.storage?.setItem(key, JSON.stringify(terms));
        } catch {
            // storage full: memory cache still applies
        }
        return terms;
    }

    private async children(url: string): Promise<GraphTerm[]> {
        const out: GraphTerm[] = [];
        let next: string | undefined = url;
        for (let pages = 0; next && pages < 50; pages++) {
            const page: { value: GraphTerm[]; "@odata.nextLink"?: string } = await this.http.json(next, { headers: { Accept: "application/json" } });
            out.push(...(page.value ?? []));
            next = page["@odata.nextLink"];
        }
        return out;
    }

    private async walk(termSetId: string, anchorId?: string): Promise<TermNode[]> {
        const siteId = await this.graphSiteId();
        const set = `${GRAPH}/sites/${encodeURIComponent(siteId)}/termStore/sets/${encodeURIComponent(termSetId)}`;
        const childrenUrl = (termId?: string) =>
            termId ? `${set}/terms/${encodeURIComponent(termId)}/children?$select=id,labels` : `${set}/children?$select=id,labels`;

        const result: TermNode[] = [];
        let level: { id?: string; path: string }[] = [{ id: anchorId, path: "" }];
        for (let depth = 0; level.length && depth < this.opts.maxDepth; depth++) {
            const nextLevel: { id?: string; path: string }[] = [];
            for (const node of level) {
                let kids: GraphTerm[];
                try {
                    kids = await this.children(childrenUrl(node.id));
                } catch (e) {
                    if (depth === 0) throw e;
                    log.warn("Could not load child terms", e);
                    continue;
                }
                for (const k of kids) {
                    const label = defaultLabel(k);
                    const path = node.path ? `${node.path} > ${label}` : label;
                    result.push({ label, termId: k.id, path });
                    nextLevel.push({ id: k.id, path });
                    if (result.length >= this.opts.maxTerms) return result;
                }
            }
            level = nextLevel;
        }
        return result;
    }
}

export function searchTerms(terms: TermNode[], query: string, limit = 50): TermNode[] {
    const q = query.trim().toLowerCase();
    if (!q) return terms.slice(0, limit);
    const starts: TermNode[] = [];
    const contains: TermNode[] = [];
    for (const t of terms) {
        const label = t.label.toLowerCase();
        if (label.startsWith(q)) starts.push(t);
        else if (t.path.toLowerCase().includes(q)) contains.push(t);
    }
    return [...starts, ...contains].slice(0, limit);
}
