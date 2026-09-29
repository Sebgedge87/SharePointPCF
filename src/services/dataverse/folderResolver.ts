import { AppError } from "../../utils/errors";
import { assertSharePointUrl, isAllowedUrl } from "../auth/hostAllowlist";
import { FolderMode } from "../appServices";
import { sanitizeFolderSegment } from "../../utils/filename";

/** Subset of ComponentFramework.WebApi. Mocked in tests. */
export interface DataverseApi {
    retrieveMultipleRecords(entityLogicalName: string, options?: string, maxPageSize?: number): Promise<{ entities: Record<string, unknown>[] }>;
    retrieveRecord(entityLogicalName: string, id: string, options?: string): Promise<Record<string, unknown>>;
    createRecord(entityLogicalName: string, data: Record<string, unknown>): Promise<{ id: string }>;
}

/** Optional shortcut: RetrieveAbsoluteAndSiteCollectionUrl bound function. */
export type AbsoluteUrlFn = (locationId: string) => Promise<{ absoluteUrl: string; siteCollectionUrl: string } | undefined>;

export interface RecordRef {
    entityName: string;
    id: string;
}

export interface ResolveSettings {
    folderMode: FolderMode;
    libraryName?: string;
    siteUrl?: string;
    fallbackTemplate?: string;
    folderUrlOverride?: string;
}

export interface ResolvedFolder {
    source: FolderMode;
    /** Absolute URL of the folder (encoded as a URL). */
    absoluteFolderUrl: string;
    /** Absolute web URL when known. Otherwise resolved against SharePoint (GetWebUrlFromPageUrl). */
    webUrl?: string;
    /** Decoded server-relative paths, filled once webUrl is known. */
    folderServerRelativeUrl: string;
    libraryServerRelativeUrl?: string;
    /** sharepointdocumentlocation id, for documentLocation mode. */
    locationId?: string;
    /** Label for the picker. */
    label: string;
    isDefaultSite?: boolean;
    /** Template folder that does not exist yet and autoCreateFolder is on. */
    needsCreate?: boolean;
}

export type FolderVerifier = (folder: ResolvedFolder) => Promise<ResolvedFolder | undefined>;

export interface ResolveResult {
    chosen?: ResolvedFolder;
    /** All candidates, for the location picker when there are several. */
    candidates: ResolvedFolder[];
    /** What was tried, for the "folder not found" state. */
    attempts: string[];
    warnings: string[];
}

const SOFT_FAILURES = new Set(["not-found", "folder-not-found", "config", "http"]);

const LOOKUP_TYPE = "@Microsoft.Dynamics.CRM.lookuplogicalname";
const FORMATTED = "@OData.Community.Display.V1.FormattedValue";
const cleanId = (id: string) => id.replace(/[{}]/g, "").toLowerCase();

const joinUrl = (base: string, ...parts: string[]) =>
    [base.replace(/\/+$/, ""), ...parts.map((p) => p.replace(/^\/+|\/+$/g, "")).filter(Boolean)].join("/");

function decodePath(pathname: string): string {
    try {
        return decodeURIComponent(pathname).replace(/\/+$/, "");
    } catch {
        return pathname.replace(/\/+$/, "");
    }
}

/** Fill server-relative paths from absolute folder + web URLs. The library is the first segment below the web. */
export function completePaths(folder: ResolvedFolder, webUrl: string): ResolvedFolder {
    const web = assertSharePointUrl(webUrl, "Site URL");
    const abs = assertSharePointUrl(folder.absoluteFolderUrl, "Folder URL");
    if (web.hostname.toLowerCase() !== abs.hostname.toLowerCase()) {
        throw new AppError("config", "The folder is not on the configured site's host.");
    }
    const webPath = decodePath(web.pathname);
    const folderPath = decodePath(abs.pathname);
    if (!(folderPath.toLowerCase() + "/").startsWith(webPath.toLowerCase() + "/") || folderPath.length <= webPath.length) {
        throw new AppError("config", "The folder is not inside the site.");
    }
    const rest = folderPath.slice(webPath.length).replace(/^\/+/, "");
    const library = rest.split("/")[0];
    return {
        ...folder,
        webUrl: `${web.origin}${web.pathname.replace(/\/+$/, "")}`,
        folderServerRelativeUrl: folderPath,
        libraryServerRelativeUrl: `${webPath}/${library}`,
    };
}

interface LocationRow {
    id: string;
    name: string;
    relativeurl?: string;
    absoluteurl?: string;
    parentId?: string;
    parentType?: string;
    createdon?: string;
}

const LOCATION_SELECT =
    "?$select=sharepointdocumentlocationid,name,relativeurl,absoluteurl,_parentsiteorlocation_value,createdon";

function toLocation(e: Record<string, unknown>): LocationRow {
    return {
        id: String(e.sharepointdocumentlocationid),
        name: String(e.name ?? ""),
        relativeurl: (e.relativeurl as string) || undefined,
        absoluteurl: (e.absoluteurl as string) || undefined,
        parentId: (e._parentsiteorlocation_value as string) || undefined,
        parentType: (e[`_parentsiteorlocation_value${LOOKUP_TYPE}`] as string) || undefined,
        createdon: e.createdon as string | undefined,
    };
}

export class FolderResolver {
    constructor(
        private readonly api: DataverseApi,
        private readonly absoluteUrlFn?: AbsoluteUrlFn,
    ) {}

    /**
     * Chain the modes (folderMode first), stopping at the first mode that yields
     * a folder that `verify` confirms exists. `verify` returns the completed
     * folder (web URL resolved) or undefined if it does not exist.
     * With `allowCreate`, an unverified template folder still wins (it will be created).
     */
    async resolve(
        record: RecordRef,
        settings: ResolveSettings,
        verify: FolderVerifier = async (f) => f,
        allowCreate = false,
    ): Promise<ResolveResult> {
        const result: ResolveResult = { candidates: [], attempts: [], warnings: [] };
        for (const mode of chainOrder(settings.folderMode)) {
            try {
                const found = await this.tryMode(mode, record, settings, result);
                if (!found.length) continue;
                const verified: ResolvedFolder[] = [];
                for (const f of found) {
                    const v = await verify(f);
                    if (v) verified.push(v);
                    else result.attempts.push(`${mode}: folder ${f.folderServerRelativeUrl || f.absoluteFolderUrl} does not exist`);
                }
                if (verified.length) {
                    result.candidates = verified;
                    result.chosen = verified[0];
                    return result;
                }
                if (mode === "template" && allowCreate) {
                    result.candidates = found;
                    result.chosen = { ...found[0], needsCreate: true };
                    return result;
                }
            } catch (e) {
                // Auth, permission, allowlist, throttling and network problems are not "try the next mode".
                if (e instanceof AppError && !SOFT_FAILURES.has(e.kind)) throw e;
                result.attempts.push(`${mode}: ${(e as Error).message}`);
            }
        }
        return result;
    }

    private async tryMode(mode: FolderMode, record: RecordRef, s: ResolveSettings, result: ResolveResult): Promise<ResolvedFolder[]> {
        switch (mode) {
            case "documentLocation":
                return this.fromDocumentLocations(record, s, result);
            case "template": {
                if (!s.fallbackTemplate) {
                    result.attempts.push("template: no fallbackTemplate configured");
                    return [];
                }
                return [await this.templateFolder(record, s)];
            }
            case "override": {
                if (!s.folderUrlOverride) {
                    result.attempts.push("override: folderUrlOverride is empty");
                    return [];
                }
                return [fromOverride(s)];
            }
        }
    }

    // ---- documentLocation -------------------------------------------------

    private async fromDocumentLocations(record: RecordRef, s: ResolveSettings, result: ResolveResult): Promise<ResolvedFolder[]> {
        const id = cleanId(record.id);
        const res = await this.api.retrieveMultipleRecords(
            "sharepointdocumentlocation",
            `${LOCATION_SELECT}&$filter=_regardingobjectid_value eq ${id} and statecode eq 0&$orderby=createdon asc`,
        );
        const rows = res.entities.map(toLocation);
        if (!rows.length) {
            result.attempts.push("documentLocation: no active document locations for this record");
            return [];
        }

        const resolved: ResolvedFolder[] = [];
        for (const row of rows) {
            try {
                resolved.push(await this.resolveLocation(row));
            } catch (e) {
                result.warnings.push(`Document location "${row.name}" could not be resolved: ${(e as Error).message}`);
            }
        }
        if (!resolved.length) {
            result.attempts.push("documentLocation: locations exist but none resolved to a SharePoint URL");
            return [];
        }

        let ordered = orderCandidates(resolved);
        const filtered = ordered.filter((c) => matchesFilters(c, s));
        if (s.libraryName || s.siteUrl) {
            if (filtered.length) ordered = [...filtered, ...ordered.filter((c) => !filtered.includes(c))];
            else result.warnings.push("No document location matched the configured library/site filter; using the default location.");
        }
        return ordered;
    }

    /** Walk parents up to the sharepointsite; fall back to RetrieveAbsoluteAndSiteCollectionUrl. */
    private async resolveLocation(row: LocationRow): Promise<ResolvedFolder> {
        try {
            return await this.walk(row);
        } catch (walkError) {
            if (!this.absoluteUrlFn) throw walkError;
            const r = await this.absoluteUrlFn(row.id);
            if (!r?.absoluteUrl) throw walkError;
            assertSharePointUrl(r.absoluteUrl, "Document location URL");
            return {
                source: "documentLocation",
                absoluteFolderUrl: r.absoluteUrl,
                folderServerRelativeUrl: decodePath(new URL(r.absoluteUrl).pathname),
                locationId: row.id,
                label: row.name,
            };
        }
    }

    private async walk(start: LocationRow): Promise<ResolvedFolder> {
        const segments: string[] = [];
        let current: LocationRow | undefined = start;
        let libraryLocationName = "";
        for (let depth = 0; current && depth < 10; depth++) {
            if (current.absoluteurl && !current.relativeurl) {
                // Location stored with an absolute URL: web unknown, resolved against SharePoint later.
                assertSharePointUrl(current.absoluteurl, "Document location URL");
                return {
                    source: "documentLocation",
                    absoluteFolderUrl: joinUrl(current.absoluteurl, ...segments.map(encodeSeg)),
                    folderServerRelativeUrl: "",
                    locationId: start.id,
                    label: start.name,
                };
            }
            if (!current.relativeurl) throw new Error("location has neither relative nor absolute URL");
            segments.unshift(current.relativeurl);
            libraryLocationName = current.name;
            if (!current.parentId) throw new Error("location has no parent site");
            if (current.parentType === "sharepointsite") {
                const site = await this.siteUrl(current.parentId);
                const absoluteFolderUrl = joinUrl(site.url, ...segments.map(encodeSeg));
                const folder = completePaths(
                    { source: "documentLocation", absoluteFolderUrl, folderServerRelativeUrl: "", locationId: start.id, label: start.name },
                    site.url,
                );
                return {
                    ...folder,
                    isDefaultSite: site.isDefault,
                    label: `${start.name} (${libraryLocationName || segments[0]})`,
                };
            }
            const parent = await this.api.retrieveRecord("sharepointdocumentlocation", current.parentId, LOCATION_SELECT);
            current = toLocation(parent);
        }
        throw new Error("location chain too deep");
    }

    private async siteUrl(siteId: string): Promise<{ url: string; isDefault: boolean }> {
        const parts: string[] = [];
        let id: string | undefined = siteId;
        let isDefault = false;
        for (let depth = 0; id && depth < 10; depth++) {
            const site = await this.api.retrieveRecord("sharepointsite", id, "?$select=absoluteurl,relativeurl,isdefault,_parentsite_value");
            if (depth === 0) isDefault = site.isdefault === true;
            if (site.absoluteurl) {
                const url = joinUrl(String(site.absoluteurl), ...parts);
                assertSharePointUrl(url, "SharePoint site URL");
                return { url, isDefault };
            }
            if (!site.relativeurl) break;
            parts.unshift(String(site.relativeurl));
            id = (site._parentsite_value as string) || undefined;
        }
        throw new Error("SharePoint site has no absolute URL");
    }

    // ---- template -----------------------------------------------------------

    /** The folder the template points at (used by the chain and by auto-create). */
    async templateFolder(record: RecordRef, s: ResolveSettings): Promise<ResolvedFolder> {
        if (!s.siteUrl) throw new Error("template mode needs siteUrl");
        assertSharePointUrl(s.siteUrl, "siteUrl");
        const path = await this.expandTemplate(s.fallbackTemplate!, record, s);
        const folder: ResolvedFolder = {
            source: "template",
            absoluteFolderUrl: joinUrl(s.siteUrl, ...path.split("/").map(encodeSeg)),
            folderServerRelativeUrl: "",
            label: path,
        };
        return completePaths(folder, s.siteUrl);
    }

    /** Public for tests: fill {tokens} from the current record. */
    async expandTemplate(template: string, record: RecordRef, s: Pick<ResolveSettings, "libraryName">): Promise<string> {
        const tokens = Array.from(new Set(Array.from(template.matchAll(/\{([^{}]+)\}/g), (m) => m[1].trim())));
        const special: Record<string, string | undefined> = {
            library: s.libraryName,
            recordid: cleanId(record.id),
            recordidN: cleanId(record.id).replace(/-/g, "").toUpperCase(),
            entityname: record.entityName,
        };
        const attrs = tokens.filter((t) => !(t in special)).map((t) => t.replace(/@formatted$/, ""));
        let values: Record<string, unknown> = {};
        if (attrs.length) {
            for (const a of attrs) {
                if (!/^[a-z_][a-z0-9_]*$/i.test(a)) throw new Error(`invalid template token {${a}}`);
            }
            values = await this.api.retrieveRecord(record.entityName, cleanId(record.id), `?$select=${Array.from(new Set(attrs)).join(",")}`);
        }
        const path = template.replace(/\{([^{}]+)\}/g, (_, raw: string) => {
            const t = raw.trim();
            let v: unknown;
            if (t in special) v = special[t];
            else if (t.endsWith("@formatted")) {
                const a = t.replace(/@formatted$/, "");
                v = values[`${a}${FORMATTED}`] ?? values[a];
            } else v = values[t];
            const text = v === null || v === undefined ? "" : String(v).trim();
            if (!text) throw new Error(`template token {${t}} is empty on this record`);
            // A token value is a single folder name: never let it add path segments.
            return sanitizeFolderSegment(text);
        });
        const segments = path.split("/").map((p) => p.trim()).filter(Boolean);
        if (segments.length < 2) throw new Error("template must produce library/folder");
        return segments.join("/");
    }

    // ---- auto-create --------------------------------------------------------

    /**
     * Write a sharepointdocumentlocation row matching a template-created folder.
     * Finds (or creates) the library location under the site record.
     */
    async createLocationRow(record: RecordRef, folder: ResolvedFolder, entitySetName: string): Promise<string> {
        if (!folder.webUrl || !folder.libraryServerRelativeUrl) throw new Error("folder paths not resolved");
        const webUrl = folder.webUrl.replace(/\/+$/, "");
        const sites = await this.api.retrieveMultipleRecords(
            "sharepointsite",
            `?$select=sharepointsiteid,absoluteurl&$filter=statecode eq 0`,
        );
        const site = sites.entities.find((e) => String(e.absoluteurl ?? "").replace(/\/+$/, "").toLowerCase() === webUrl.toLowerCase());
        if (!site) throw new Error(`No SharePoint site record in Dataverse for ${webUrl}`);
        const siteId = String(site.sharepointsiteid);

        const libSegment = folder.libraryServerRelativeUrl.split("/").pop()!;
        const libs = await this.api.retrieveMultipleRecords(
            "sharepointdocumentlocation",
            `${LOCATION_SELECT}&$filter=_parentsiteorlocation_value eq ${cleanId(siteId)} and statecode eq 0`,
        );
        let libId = libs.entities
            .map(toLocation)
            .find((l) => (l.relativeurl ?? "").toLowerCase() === libSegment.toLowerCase())?.id;
        if (!libId) {
            libId = (
                await this.api.createRecord("sharepointdocumentlocation", {
                    name: libSegment,
                    relativeurl: libSegment,
                    "parentsiteorlocation_sharepointsite@odata.bind": `/sharepointsites(${cleanId(siteId)})`,
                })
            ).id;
        }
        const relative = folder.folderServerRelativeUrl.slice(folder.libraryServerRelativeUrl.length).replace(/^\/+/, "");
        const created = await this.api.createRecord("sharepointdocumentlocation", {
            name: relative.split("/").pop(),
            relativeurl: relative,
            "parentsiteorlocation_sharepointdocumentlocation@odata.bind": `/sharepointdocumentlocations(${cleanId(libId)})`,
            [`regardingobjectid_${record.entityName}@odata.bind`]: `/${entitySetName}(${cleanId(record.id)})`,
        });
        return created.id;
    }
}

function encodeSeg(segment: string): string {
    return segment
        .split("/")
        .map((s) => encodeURIComponent(s))
        .join("/");
}

export function chainOrder(mode: FolderMode): FolderMode[] {
    const all: FolderMode[] = ["documentLocation", "template", "override"];
    return [mode, ...all.filter((m) => m !== mode)];
}

function fromOverride(s: ResolveSettings): ResolvedFolder {
    const url = s.folderUrlOverride!.trim();
    assertSharePointUrl(url, "folderUrlOverride");
    const folder: ResolvedFolder = {
        source: "override",
        absoluteFolderUrl: url.replace(/\/+$/, ""),
        folderServerRelativeUrl: decodePath(new URL(url).pathname),
        label: "Override",
    };
    if (s.siteUrl && isAllowedUrl(s.siteUrl)) {
        try {
            return completePaths(folder, s.siteUrl);
        } catch {
            // override is outside siteUrl: web resolved against SharePoint later
        }
    }
    return folder;
}

function orderCandidates(list: ResolvedFolder[]): ResolvedFolder[] {
    // default site first, then Dataverse order (createdon asc); stable sort
    return list
        .map((c, i) => ({ c, i }))
        .sort((a, b) => Number(!!b.c.isDefaultSite) - Number(!!a.c.isDefaultSite) || a.i - b.i)
        .map((x) => x.c);
}

function matchesFilters(c: ResolvedFolder, s: ResolveSettings): boolean {
    if (s.siteUrl && c.webUrl && c.webUrl.replace(/\/+$/, "").toLowerCase() !== s.siteUrl.replace(/\/+$/, "").toLowerCase()) {
        return false;
    }
    if (s.libraryName) {
        const want = s.libraryName.trim().toLowerCase();
        const segment = (c.libraryServerRelativeUrl ?? c.folderServerRelativeUrl).split("/").pop()?.toLowerCase();
        const encodedWant = want.replace(/\s+/g, "");
        if (segment !== want && segment !== encodedWant && !c.label.toLowerCase().includes(want)) return false;
    }
    return true;
}
