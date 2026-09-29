import { SharePointRest, aliasQuery } from "./spRest";
import { redact } from "../auth/redact";
import { isAppError } from "../../utils/errors";

/**
 * Phase 1 spike: prove a delegated token (Sites.Selected or AllSites.Write)
 * works against SharePoint _api REST for a given site. Run from the control by
 * setting viewName to "__spike__" (see README). Results never include tokens.
 */
export interface SpikeStep {
    name: string;
    ok: boolean;
    detail: string;
}

export interface SpikeOptions {
    /** Library title for the list + write checks. */
    libraryTitle?: string;
    /** Upload then recycle a zero-byte file in the library root to prove write access. */
    write?: boolean;
    newGuid?: () => string;
}

async function step(steps: SpikeStep[], name: string, fn: () => Promise<string>): Promise<boolean> {
    try {
        const detail = await fn();
        steps.push({ name, ok: true, detail });
        return true;
    } catch (e) {
        const kind = isAppError(e) ? `[${e.kind}${e.status ? ` ${e.status}` : ""}] ` : "";
        steps.push({ name, ok: false, detail: kind + redact(e instanceof Error ? e.message : e) });
        return false;
    }
}

export async function runSharePointSpike(sp: SharePointRest, opts: SpikeOptions = {}): Promise<SpikeStep[]> {
    const steps: SpikeStep[] = [];
    const webOk = await step(steps, "GET /_api/web (token accepted, site readable)", async () => {
        const web = await sp.get<{ Title: string; Url: string }>("web?$select=Title,Url");
        return `Site "${web.Title}"`;
    });
    if (!webOk || !opts.libraryTitle) return steps;

    const lib = opts.libraryTitle;
    let rootFolder = "";
    const listOk = await step(steps, `GET list "${lib}"`, async () => {
        const list = await sp.get<{ Title: string; ItemCount: number; RootFolder: { ServerRelativeUrl: string } }>(
            `web/lists/getbytitle(@l)${aliasQuery({ l: lib }, { $select: "Title,ItemCount,RootFolder/ServerRelativeUrl", $expand: "RootFolder" })}`,
        );
        rootFolder = list.RootFolder.ServerRelativeUrl;
        return `${list.ItemCount} items; root ${rootFolder}`;
    });
    if (!listOk || !opts.write) return steps;

    const name = `__pcf_spike_${(opts.newGuid ?? defaultGuid)()}.txt`;
    const path = `${rootFolder}/${name}`;
    const created = await step(steps, "POST upload zero-byte file (write)", async () => {
        await sp.post(
            `web/GetFolderByServerRelativePath(decodedurl=@f)/Files/AddUsingPath(decodedurl=@n,overwrite=false)${aliasQuery({ f: rootFolder, n: name })}`,
            new ArrayBuffer(0),
        );
        return name;
    });
    if (created) {
        await step(steps, "POST recycle spike file (cleanup)", async () => {
            await sp.post(`web/GetFileByServerRelativePath(decodedurl=@p)/recycle()${aliasQuery({ p: path })}`);
            return "recycled";
        });
    }
    return steps;
}

function defaultGuid(): string {
    return typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
}
