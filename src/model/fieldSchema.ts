/**
 * Normalised SharePoint field schema. Built from /fields; this is the raw
 * schema used for editing (display values come from render data).
 */
export interface FieldSchema {
    id: string;
    internalName: string;
    title: string;
    typeAsString: string;
    required: boolean;
    readOnlyField: boolean;
    hidden: boolean;
    sealed?: boolean;
    maxLength?: number;
    choices?: string[];
    fillInChoice?: boolean;
    richText?: boolean;
    appendOnly?: boolean;
    lookupList?: string;
    lookupField?: string;
    lookupWebId?: string;
    termSetId?: string;
    anchorId?: string;
    sspId?: string;
    allowMultipleValues?: boolean;
    /** DateTime: 0 = DateOnly, 1 = DateTime */
    displayFormat?: number;
    minimumValue?: number;
    maximumValue?: number;
    /** Number: -1 = automatic */
    decimals?: number;
    showAsPercentage?: boolean;
    currencyLocaleId?: number;
    defaultValue?: string | null;
    /** User fields: 0 = people only, 1 = people and groups */
    selectionMode?: number;
    selectionGroup?: number;
}

/** $select for the /fields call. */
export const FIELD_SELECT = [
    "Id",
    "InternalName",
    "Title",
    "TypeAsString",
    "Required",
    "ReadOnlyField",
    "Hidden",
    "Sealed",
    "MaxLength",
    "Choices",
    "FillInChoice",
    "RichText",
    "AppendOnly",
    "LookupList",
    "LookupField",
    "LookupWebId",
    "TermSetId",
    "AnchorId",
    "SspId",
    "AllowMultipleValues",
    "DisplayFormat",
    "MinimumValue",
    "MaximumValue",
    "DefaultValue",
    "SelectionMode",
    "SelectionGroup",
    "ShowAsPercentage",
    "CurrencyLocaleId",
].join(",");

type RawField = Record<string, unknown>;

const num = (v: unknown): number | undefined => {
    if (typeof v === "number" && isFinite(v)) return v;
    if (typeof v === "string" && v.trim() !== "" && isFinite(Number(v))) return Number(v);
    return undefined;
};
const str = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);
const bool = (v: unknown): boolean => v === true || v === "TRUE" || v === "true";

/** Choices come back as string[] (nometadata) or { results: [] } (verbose). */
function choicesOf(v: unknown): string[] | undefined {
    if (Array.isArray(v)) return v.map(String);
    const results = (v as { results?: unknown[] } | undefined)?.results;
    return Array.isArray(results) ? results.map(String) : undefined;
}

const EMPTY_GUID = "00000000-0000-0000-0000-000000000000";

export function normalizeField(raw: RawField): FieldSchema {
    const anchor = str(raw.AnchorId);
    const decimalsRaw = num(raw.Decimals ?? raw.DisplayFormat);
    const type = String(raw.TypeAsString ?? "");
    return {
        id: String(raw.Id ?? ""),
        internalName: String(raw.InternalName ?? ""),
        title: String(raw.Title ?? raw.InternalName ?? ""),
        typeAsString: type,
        required: bool(raw.Required),
        readOnlyField: bool(raw.ReadOnlyField),
        hidden: bool(raw.Hidden),
        sealed: bool(raw.Sealed),
        maxLength: num(raw.MaxLength),
        choices: choicesOf(raw.Choices),
        fillInChoice: bool(raw.FillInChoice),
        richText: bool(raw.RichText),
        appendOnly: bool(raw.AppendOnly),
        lookupList: str(raw.LookupList)?.replace(/[{}]/g, ""),
        lookupField: str(raw.LookupField),
        lookupWebId: str(raw.LookupWebId),
        termSetId: str(raw.TermSetId),
        anchorId: anchor && anchor !== EMPTY_GUID ? anchor : undefined,
        sspId: str(raw.SspId),
        allowMultipleValues: bool(raw.AllowMultipleValues),
        displayFormat: type === "DateTime" ? num(raw.DisplayFormat) : undefined,
        minimumValue: num(raw.MinimumValue),
        maximumValue: num(raw.MaximumValue),
        decimals: type === "Number" || type === "Currency" ? decimalsRaw : undefined,
        showAsPercentage: bool(raw.ShowAsPercentage),
        currencyLocaleId: num(raw.CurrencyLocaleId),
        defaultValue: (raw.DefaultValue as string | null | undefined) ?? null,
        selectionMode: num(raw.SelectionMode),
        selectionGroup: num(raw.SelectionGroup),
    };
}

/**
 * Fields that are system-managed or computed: always render read-only,
 * whatever the schema flags say.
 */
export const SYSTEM_FIELDS = new Set([
    "ID",
    "Created",
    "Modified",
    "Author",
    "Editor",
    "FileRef",
    "FileDirRef",
    "FSObjType",
    "File_x0020_Size",
    "FileSizeDisplay",
    "DocIcon",
    "ContentType",
    "ContentTypeId",
    "CheckoutUser",
    "_UIVersionString",
    "Edit",
    "LinkFilename",
    "LinkFilenameNoMenu",
    "SelectTitle",
    "ItemChildCount",
    "FolderChildCount",
    "_ComplianceTag",
    "_ComplianceTagWrittenTime",
    "_ComplianceTagUserId",
    "_IsRecord",
    "AppAuthor",
    "AppEditor",
]);

/** The file name column. Editable (rename) but handled specially. */
export const FILENAME_FIELD = "FileLeafRef";

/** View field aliases: views reference link/computed names that map to a real field. */
export const VIEW_FIELD_ALIASES: Record<string, string> = {
    LinkFilename: FILENAME_FIELD,
    LinkFilenameNoMenu: FILENAME_FIELD,
    LinkTitle: "Title",
    LinkTitleNoMenu: "Title",
};
