import { ColumnModel } from "./columns";
import { EditValue, UrlValue, isEmptyValue } from "./values";
import { splitExtension, validateFileName } from "../utils/filename";

export interface ValidationContext {
    /** "edit": schema-required only. "upload": requiredOnUpload (schema or stricter config). */
    mode: "edit" | "upload";
    folderServerRelativeUrl?: string;
    /** Current file name, to keep the extension on rename. */
    originalFileName?: string;
}

const URL_RE = /^(https?|ftp|mailto|file):/i;

/** Client-side validation. SharePoint remains the authority (validateUpdateListItem). */
export function validateValue(column: ColumnModel, value: EditValue | undefined, ctx: ValidationContext): string | undefined {
    if (!column.editable) return undefined;
    const required = ctx.mode === "upload" ? column.requiredOnUpload : column.requiredBySchema;
    if (isEmptyValue(column.editor, value)) {
        if (column.editor === "filename") return "Enter a file name.";
        return required ? `${column.label} is required.` : undefined;
    }
    const f = column.field;
    switch (column.editor) {
        case "filename": {
            const name = String(value);
            const check = validateFileName(name, ctx.folderServerRelativeUrl);
            if (!check.valid) return check.error;
            if (ctx.originalFileName) {
                const want = splitExtension(ctx.originalFileName).ext.toLowerCase();
                if (splitExtension(name).ext.toLowerCase() !== want) return `Keep the ${want || "original"} extension.`;
            }
            return undefined;
        }
        case "text":
        case "textarea": {
            const s = String(value);
            const max = f.maxLength ?? (column.editor === "text" ? 255 : undefined);
            if (max && s.length > max) return `Use ${max} characters or fewer (currently ${s.length}).`;
            return undefined;
        }
        case "choice":
            if (!f.fillInChoice && f.choices && !f.choices.includes(String(value))) return "Pick one of the listed choices.";
            return undefined;
        case "multichoice":
            if (!f.fillInChoice && f.choices && (value as string[]).some((v) => !f.choices!.includes(v))) return "Pick from the listed choices.";
            return undefined;
        case "number": {
            const n = value as number;
            if (typeof n !== "number" || !isFinite(n)) return "Enter a number.";
            // Percent columns store 0-1 but min/max are in the same units
            if (f.minimumValue !== undefined && n < f.minimumValue) return `Must be ${f.minimumValue} or more.`;
            if (f.maximumValue !== undefined && n > f.maximumValue) return `Must be ${f.maximumValue} or less.`;
            return undefined;
        }
        case "date":
            return /^\d{4}-\d{2}-\d{2}$/.test(String(value)) ? undefined : "Enter a valid date.";
        case "datetime":
            return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(String(value)) ? undefined : "Enter a valid date and time.";
        case "url": {
            const u = value as UrlValue;
            if (!URL_RE.test(u.url.trim())) return "Enter a full address starting with https://";
            if (u.url.length > 255) return "The address must be 255 characters or fewer.";
            return undefined;
        }
        default:
            return undefined;
    }
}

export function validateAll(columns: ColumnModel[], values: Record<string, EditValue>, ctx: ValidationContext): Record<string, string> {
    const errors: Record<string, string> = {};
    for (const c of columns) {
        if (!(c.key in values) && ctx.mode === "edit") continue;
        const e = validateValue(c, values[c.key], ctx);
        if (e) errors[c.key] = e;
    }
    return errors;
}
