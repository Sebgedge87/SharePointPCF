import { ColumnConfig } from "../config/columnConfig";
import { applyEditorOverride, EditorKind, resolveEditor } from "./editorRegistry";
import { FieldSchema, VIEW_FIELD_ALIASES } from "./fieldSchema";
import { log } from "../services/auth/redact";

export interface ColumnModel {
    key: string;
    field: FieldSchema;
    label: string;
    editor: EditorKind;
    editable: boolean;
    /** SharePoint says required (list field or content type field link). */
    requiredBySchema: boolean;
    /** Must be provided before upload (schema or stricter columnConfig). */
    requiredOnUpload: boolean;
    defaultValue?: unknown;
    readOnlyReason?: string;
}

export interface ContentTypeInfo {
    id: string;
    name: string;
    /** InternalName -> required flag from FieldLinks. Only fields in the CT. */
    fieldLinks: Record<string, { required: boolean; hidden: boolean }>;
}

export interface BuildColumnsResult {
    /** Visible grid columns, in view order. */
    columns: ColumnModel[];
    warnings: string[];
}

const loggedUnsupported = new Set<string>();

export function buildColumn(field: FieldSchema, config: ColumnConfig, warnings: string[], ctRequired = false): ColumnModel {
    const override = config[field.internalName] ?? {};
    const resolved = resolveEditor(field);
    if (resolved.reason?.startsWith("unsupported") && !loggedUnsupported.has(field.typeAsString)) {
        loggedUnsupported.add(field.typeAsString);
        log.warn(`Column type "${field.typeAsString}" is not supported; ${field.internalName} is read-only.`);
    }

    let editor = resolved.editor;
    const overridden = applyEditorOverride(editor, override.editor);
    if (overridden === undefined) {
        warnings.push(
            `columnConfig.${field.internalName}.editor "${override.editor}" is not compatible with a ${field.typeAsString} column; ignored.`,
        );
    } else {
        editor = overridden;
    }

    // Stricter, never looser: readOnly:false cannot unlock; requiredOnUpload:false cannot relax.
    const editable = editor !== "readonly" && override.readOnly !== true;
    if (override.readOnly === false && resolved.editor === "readonly") {
        warnings.push(`columnConfig.${field.internalName}.readOnly=false cannot make a read-only column editable; ignored.`);
    }
    const requiredBySchema = field.required || ctRequired;
    if (override.requiredOnUpload === false && requiredBySchema) {
        warnings.push(`columnConfig.${field.internalName}.requiredOnUpload=false cannot relax a required column; ignored.`);
    }
    const requiredOnUpload = editable && (requiredBySchema || override.requiredOnUpload === true);

    return {
        key: field.internalName,
        field,
        label: override.label ?? field.title,
        editor: editable ? editor : "readonly",
        editable,
        requiredBySchema,
        requiredOnUpload,
        defaultValue: override.default,
        readOnlyReason: editable ? undefined : (resolved.reason ?? "read-only by configuration"),
    };
}

/**
 * View fields -> grid columns. Fields not found in the schema (e.g. removed
 * columns still referenced by the view) are skipped with a warning.
 */
export function buildColumns(viewFields: string[], fields: FieldSchema[], config: ColumnConfig): BuildColumnsResult {
    const warnings: string[] = [];
    const byName = new Map(fields.map((f) => [f.internalName, f]));
    const seen = new Set<string>();
    const columns: ColumnModel[] = [];

    for (const vf of viewFields) {
        const name = VIEW_FIELD_ALIASES[vf] ?? vf;
        if (seen.has(name)) continue;
        seen.add(name);
        const field = byName.get(name) ?? byName.get(vf);
        if (!field) {
            // Hidden fields are filtered out of /fields; only warn for truly unknown ones.
            if (vf !== "DocIcon") warnings.push(`View column "${vf}" was not found in the list schema; skipped.`);
            continue;
        }
        if (config[field.internalName]?.hidden) continue;
        columns.push(buildColumn(field, config, warnings));
    }
    for (const key of Object.keys(config)) {
        if (!byName.has(key)) warnings.push(`columnConfig refers to unknown column "${key}".`);
    }
    return { columns, warnings };
}

/**
 * Fields the pre-upload dialog must collect for a content type: every
 * required, editable field in the content type (not just view columns),
 * plus anything columnConfig marks requiredOnUpload.
 */
export function uploadColumnsFor(ct: ContentTypeInfo | undefined, fields: FieldSchema[], config: ColumnConfig): ColumnModel[] {
    const warnings: string[] = [];
    const out: ColumnModel[] = [];
    for (const field of fields) {
        if (field.internalName === "FileLeafRef" || field.internalName === "ContentType") continue;
        const link = ct?.fieldLinks[field.internalName];
        if (ct && !link && !config[field.internalName]?.requiredOnUpload) continue;
        if (link?.hidden) continue;
        const col = buildColumn(field, config, warnings, link?.required ?? false);
        if (col.requiredOnUpload) out.push(col);
    }
    return out;
}
