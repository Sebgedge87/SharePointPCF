import { FieldSchema, FILENAME_FIELD, SYSTEM_FIELDS } from "./fieldSchema";

export type EditorKind =
    | "filename"
    | "text"
    | "textarea"
    | "choice"
    | "multichoice"
    | "number"
    | "date"
    | "datetime"
    | "boolean"
    | "lookup"
    | "lookupMulti"
    | "user"
    | "userMulti"
    | "taxonomy"
    | "taxonomyMulti"
    | "url"
    | "readonly";

export interface EditorResolution {
    editor: EditorKind;
    /** Why a field fell back to read-only (for logs / tooltips). */
    reason?: string;
}

/** Types we know are never editable through validateUpdateListItem. */
const READONLY_TYPES = new Set([
    "Calculated",
    "Computed",
    "Counter",
    "Attachments",
    "ContentTypeId",
    "Guid",
    "ModStat",
    "WorkflowStatus",
    "ThreadIndex",
    "Threading",
    "Integer",
    "Lookup_x0020_Hidden",
    "OutcomeChoice",
    "AverageRating",
    "RatingCount",
    "Likes",
    "Location",
    "Geolocation",
    "Thumbnail",
]);

/**
 * Field -> editor. Anything not recognised degrades to read-only: the grid
 * must never crash on a column type it has not seen.
 */
export function resolveEditor(field: FieldSchema): EditorResolution {
    if (field.internalName === FILENAME_FIELD) return { editor: "filename" };
    if (SYSTEM_FIELDS.has(field.internalName)) return { editor: "readonly", reason: "system column" };
    if (field.readOnlyField) return { editor: "readonly", reason: "read-only in SharePoint" };

    const multi = !!field.allowMultipleValues;
    switch (field.typeAsString) {
        case "Text":
            return { editor: "text" };
        case "Note":
            if (field.richText) return { editor: "readonly", reason: "rich text" };
            if (field.appendOnly) return { editor: "readonly", reason: "append-only" };
            return { editor: "textarea" };
        case "Choice":
            return { editor: "choice" };
        case "MultiChoice":
            return { editor: "multichoice" };
        case "Number":
        case "Currency":
            return { editor: "number" };
        case "DateTime":
            return { editor: field.displayFormat === 1 ? "datetime" : "date" };
        case "Boolean":
            return { editor: "boolean" };
        case "Lookup":
            return { editor: multi ? "lookupMulti" : "lookup" };
        case "LookupMulti":
            return { editor: "lookupMulti" };
        case "User":
            return { editor: multi ? "userMulti" : "user" };
        case "UserMulti":
            return { editor: "userMulti" };
        case "TaxonomyFieldType":
            return { editor: multi ? "taxonomyMulti" : "taxonomy" };
        case "TaxonomyFieldTypeMulti":
            return { editor: "taxonomyMulti" };
        case "URL":
            return { editor: "url" };
        default:
            if (READONLY_TYPES.has(field.typeAsString)) return { editor: "readonly", reason: `${field.typeAsString} column` };
            return { editor: "readonly", reason: `unsupported type ${field.typeAsString || "(none)"}` };
    }
}

/**
 * A columnConfig "editor" override may only make a column stricter or pick an
 * equivalent editor for the same type. Returns undefined when not allowed.
 */
const COMPATIBLE: Partial<Record<EditorKind, EditorKind[]>> = {
    text: ["textarea"],
    textarea: ["text"],
    datetime: ["date"],
};

export function applyEditorOverride(base: EditorKind, requested: string | undefined): EditorKind | undefined {
    if (!requested) return base;
    const want = requested as EditorKind;
    if (want === "readonly") return "readonly";
    if (want === base) return base;
    return COMPATIBLE[base]?.includes(want) ? want : undefined;
}

export function isMultiEditor(e: EditorKind): boolean {
    return e === "multichoice" || e === "lookupMulti" || e === "userMulti" || e === "taxonomyMulti";
}
