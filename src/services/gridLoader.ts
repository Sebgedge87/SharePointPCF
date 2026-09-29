import { AppError, isAppError } from "../utils/errors";
import { FolderResolver, RecordRef, ResolvedFolder, ResolveSettings, completePaths } from "./dataverse/folderResolver";
import { ListInfo, ListService, ViewInfo, getWebUrlFromPageUrl } from "./sharepoint/lists";
import { ItemService } from "./sharepoint/items";
import { SharePointRest } from "./sharepoint/spRest";
import { FieldSchema } from "../model/fieldSchema";
import { ColumnModel, ContentTypeInfo, buildColumns } from "../model/columns";
import { RegionalSettings } from "../model/regional";
import { ColumnConfig } from "../config/columnConfig";
import { assertSharePointUrl } from "./auth/hostAllowlist";

export interface GridSession {
    folder: ResolvedFolder;
    candidates: ResolvedFolder[];
    sp: SharePointRest;
    lists: ListService;
    items: ItemService;
    list: ListInfo;
    view: ViewInfo;
    fields: FieldSchema[];
    contentTypes: ContentTypeInfo[];
    regional: RegionalSettings;
    columns: ColumnModel[];
    warnings: string[];
}

export interface LoadInput {
    resolver: FolderResolver;
    record: RecordRef;
    settings: ResolveSettings;
    viewName: string;
    autoCreateFolder: boolean;
    columnConfig: ColumnConfig;
    sharePoint: (webUrl: string) => SharePointRest;
    /** Entity set name for the regarding bind when auto-creating a location row. */
    entitySetName: () => Promise<string>;
    /** Skip resolution and load this candidate (location picker). */
    chosen?: ResolvedFolder;
    candidates?: ResolvedFolder[];
}

/** Fill in the web URL (via SharePoint) when the location did not tell us. */
async function completeFolder(folder: ResolvedFolder, input: LoadInput): Promise<ResolvedFolder> {
    if (folder.webUrl && folder.libraryServerRelativeUrl) return folder;
    const abs = assertSharePointUrl(folder.absoluteFolderUrl, "Folder URL");
    const probe = input.sharePoint(input.settings.siteUrl ?? abs.origin);
    const webUrl = await getWebUrlFromPageUrl(probe, folder.absoluteFolderUrl);
    return completePaths(folder, webUrl);
}

/** Resolve -> verify -> read schema. Throws AppError("folder-not-found") with what was tried. */
export async function loadGridSession(input: LoadInput): Promise<GridSession> {
    const warnings: string[] = [];
    let folder: ResolvedFolder | undefined;
    let candidates: ResolvedFolder[];

    const verify = async (f: ResolvedFolder) => {
        const complete = await completeFolder(f, input);
        const exists = await new ListService(input.sharePoint(complete.webUrl!)).folderExists(complete.folderServerRelativeUrl);
        return exists ? complete : undefined;
    };

    if (input.chosen) {
        folder = await verify(input.chosen);
        candidates = input.candidates ?? [input.chosen];
        if (!folder) throw new AppError("folder-not-found", `The folder ${input.chosen.label} does not exist in SharePoint.`);
    } else {
        const result = await input.resolver.resolve(input.record, input.settings, verify, input.autoCreateFolder);
        warnings.push(...result.warnings);
        candidates = result.candidates;
        folder = result.chosen;
        if (!folder) {
            throw new AppError(
                "folder-not-found",
                `No SharePoint folder was found for this record. Tried: ${result.attempts.join("; ") || "nothing configured"}.`,
            );
        }
    }

    folder = await completeFolder(folder, input);
    const sp = input.sharePoint(folder.webUrl!);
    const lists = new ListService(sp);
    let list: ListInfo;
    try {
        list = await lists.getListByUrl(folder.libraryServerRelativeUrl!);
    } catch (e) {
        if (isAppError(e, "not-found")) throw new AppError("folder-not-found", `No document library at ${folder.libraryServerRelativeUrl}.`);
        throw e;
    }

    if (folder.needsCreate) {
        // autoCreateFolder: template only, then a matching sharepointdocumentlocation row.
        await lists.ensureFolder(list.rootFolderServerRelativeUrl, folder.folderServerRelativeUrl);
        try {
            folder = { ...folder, needsCreate: false, locationId: await input.resolver.createLocationRow(input.record, folder, await input.entitySetName()) };
        } catch (e) {
            folder = { ...folder, needsCreate: false };
            warnings.push(`The folder was created but no document location row could be written: ${(e as Error).message}`);
        }
        candidates = [folder];
    }

    const [view, fields, contentTypes, regional] = await Promise.all([
        lists.getView(list, input.viewName),
        lists.getFields(list),
        lists.getContentTypes(list),
        lists.getRegionalSettings(),
    ]);
    const built = buildColumns(view.viewFields, fields, input.columnConfig);
    warnings.push(...built.warnings);

    return {
        folder,
        candidates: candidates.length ? candidates : [folder],
        sp,
        lists,
        items: new ItemService(sp, list),
        list,
        view,
        fields,
        contentTypes,
        regional,
        columns: built.columns,
        warnings,
    };
}
