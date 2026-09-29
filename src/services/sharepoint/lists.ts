import { SharePointRest, aliasQuery } from "./spRest";
import { FieldSchema, normalizeField } from "../../model/fieldSchema";
import { ContentTypeInfo } from "../../model/columns";
import { AppError, isAppError } from "../../utils/errors";
import { RegionalSettings } from "../../model/regional";

export interface ListInfo {
    id: string;
    title: string;
    rootFolderServerRelativeUrl: string;
    enableVersioning: boolean;
    forceCheckout: boolean;
}

export interface ViewInfo {
    id: string;
    title: string;
    viewFields: string[];
    /** Inner CAML (<Where>, <OrderBy>, ...) */
    viewQuery: string;
    rowLimit: number;
}

type ListRow = {
    Id: string;
    Title: string;
    EnableVersioning: boolean;
    ForceCheckout: boolean;
    RootFolder: { ServerRelativeUrl: string };
};

const LIST_QUERY = { $select: "Id,Title,EnableVersioning,ForceCheckout,RootFolder/ServerRelativeUrl", $expand: "RootFolder" };

function toListInfo(r: ListRow): ListInfo {
    return {
        id: r.Id,
        title: r.Title,
        rootFolderServerRelativeUrl: r.RootFolder.ServerRelativeUrl,
        enableVersioning: !!r.EnableVersioning,
        forceCheckout: !!r.ForceCheckout,
    };
}

export class ListService {
    constructor(readonly sp: SharePointRest) {}

    /** The list whose root folder is at this server-relative URL. */
    async getListByUrl(libraryServerRelativeUrl: string): Promise<ListInfo> {
        const r = await this.sp.get<ListRow>(`web/GetList(@u)${aliasQuery({ u: libraryServerRelativeUrl }, LIST_QUERY)}`);
        return toListInfo(r);
    }

    async getListByTitle(title: string): Promise<ListInfo> {
        const r = await this.sp.get<ListRow>(`web/lists/getbytitle(@t)${aliasQuery({ t: title }, LIST_QUERY)}`);
        return toListInfo(r);
    }

    listPath(list: ListInfo): string {
        return `web/lists(guid'${list.id}')`;
    }

    async getView(list: ListInfo, viewName: string): Promise<ViewInfo> {
        try {
            const v = await this.sp.get<{
                Id: string;
                Title: string;
                ViewQuery: string;
                RowLimit: number;
                ViewFields: { Items: string[] | { results: string[] } };
            }>(`${this.listPath(list)}/views/getbytitle(@v)${aliasQuery({ v: viewName }, { $select: "Id,Title,ViewQuery,RowLimit,ViewFields/Items", $expand: "ViewFields" })}`);
            const items = Array.isArray(v.ViewFields.Items) ? v.ViewFields.Items : (v.ViewFields.Items?.results ?? []);
            return { id: v.Id, title: v.Title, viewFields: items, viewQuery: v.ViewQuery ?? "", rowLimit: v.RowLimit || 30 };
        } catch (e) {
            if (isAppError(e, "not-found") || (isAppError(e, "http") && e.status === 400)) {
                throw new AppError("config", `View "${viewName}" was not found in library "${list.title}".`);
            }
            throw e;
        }
    }

    async getFields(list: ListInfo): Promise<FieldSchema[]> {
        // No $select: derived-type properties (Choices, LookupList, TermSetId, ...) are returned per type.
        const r = await this.sp.get<{ value: Record<string, unknown>[] }>(`${this.listPath(list)}/fields?$filter=Hidden eq false`);
        return r.value.map(normalizeField);
    }

    /** Document content types (folders and hidden ones excluded) with their field links. */
    async getContentTypes(list: ListInfo): Promise<ContentTypeInfo[]> {
        const r = await this.sp.get<{
            value: {
                StringId: string;
                Name: string;
                Hidden: boolean;
                FieldLinks: { Name: string; Required: boolean; Hidden: boolean }[] | { results: { Name: string; Required: boolean; Hidden: boolean }[] };
            }[];
        }>(`${this.listPath(list)}/contenttypes?$select=StringId,Name,Hidden,FieldLinks/Name,FieldLinks/Required,FieldLinks/Hidden&$expand=FieldLinks`);
        return r.value
            .filter((ct) => !ct.Hidden && !ct.StringId.startsWith("0x0120"))
            .map((ct) => {
                const links = Array.isArray(ct.FieldLinks) ? ct.FieldLinks : (ct.FieldLinks?.results ?? []);
                const fieldLinks: ContentTypeInfo["fieldLinks"] = {};
                for (const l of links) fieldLinks[l.Name] = { required: !!l.Required, hidden: !!l.Hidden };
                return { id: ct.StringId, name: ct.Name, fieldLinks };
            });
    }

    async getRegionalSettings(): Promise<RegionalSettings> {
        const r = await this.sp.get<{
            LocaleId: number;
            DateFormat: number;
            DateSeparator: string;
            DecimalSeparator: string;
            ThousandSeparator: string;
            Time24: boolean;
            TimeSeparator: string;
        }>("web/RegionalSettings?$select=LocaleId,DateFormat,DateSeparator,DecimalSeparator,ThousandSeparator,Time24,TimeSeparator");
        return {
            localeId: r.LocaleId,
            dateFormat: r.DateFormat,
            dateSeparator: r.DateSeparator || "/",
            decimalSeparator: r.DecimalSeparator || ".",
            thousandSeparator: r.ThousandSeparator ?? ",",
            time24: !!r.Time24,
            timeSeparator: r.TimeSeparator || ":",
        };
    }

    /** Verify a folder exists (folders/getbyurl equivalent that is safe for any characters). */
    async folderExists(folderServerRelativeUrl: string): Promise<boolean> {
        try {
            const r = await this.sp.get<{ Exists?: boolean } | undefined>(
                `web/GetFolderByServerRelativePath(decodedurl=@f)${aliasQuery({ f: folderServerRelativeUrl }, { $select: "Exists" })}`,
                { allow404: true },
            );
            return !!r && r.Exists !== false;
        } catch (e) {
            if (isAppError(e, "not-found")) return false;
            throw e;
        }
    }

    /** Create each missing segment below the library root. */
    async ensureFolder(libraryServerRelativeUrl: string, folderServerRelativeUrl: string): Promise<void> {
        const rest = folderServerRelativeUrl.slice(libraryServerRelativeUrl.length).split("/").filter(Boolean);
        let path = libraryServerRelativeUrl;
        for (const seg of rest) {
            path = `${path}/${seg}`;
            if (await this.folderExists(path)) continue;
            await this.sp.post(`web/Folders/AddUsingPath(decodedurl=@f,overwrite=false)${aliasQuery({ f: path })}`);
        }
    }

    /** Names of files directly in the folder (live listing for collision checks). */
    async listFileNames(folderServerRelativeUrl: string): Promise<string[]> {
        const r = await this.sp.get<{ value: { Name: string }[] }>(
            `web/GetFolderByServerRelativePath(decodedurl=@f)/Files${aliasQuery({ f: folderServerRelativeUrl }, { $select: "Name", $top: "5000" })}`,
        );
        return r.value.map((f) => f.Name);
    }
}

/** Web URL for any URL inside it. Used when a location/override did not tell us the site. */
export async function getWebUrlFromPageUrl(sp: SharePointRest, absoluteUrl: string): Promise<string> {
    const r = await sp.post<{ value: string }>(`SP.Web.GetWebUrlFromPageUrl(@v)${aliasQuery({ v: absoluteUrl })}`);
    if (!r?.value) throw new AppError("folder-not-found", "Could not determine the SharePoint site for the folder.");
    return r.value;
}
