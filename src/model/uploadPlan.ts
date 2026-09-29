import { ColumnModel, ContentTypeInfo } from "./columns";
import { EditValue, emptyValue, isEmptyValue, serializeValue } from "./values";
import { RegionalSettings } from "./regional";
import { FormValue } from "../services/sharepoint/items";
import { nameExists, nextAvailableName, validateFileName } from "../utils/filename";

export type CollisionChoice = "replace" | "rename" | "skip";

export interface PlannedFile {
    id: string;
    file: Blob & { name: string };
    /** Name it will be uploaded as (rename changes this). */
    targetName: string;
    /** Name clashes with a live file in the folder or an earlier file in this batch. */
    collides: boolean;
    /** The name that collided (what Replace writes; what Rename starts from). */
    requestedName?: string;
    choice?: CollisionChoice;
}

/**
 * Mark collisions against the *live* folder listing and against earlier
 * files in the same batch (two drops with the same name).
 */
export function detectCollisions(files: PlannedFile[], existing: string[]): PlannedFile[] {
    const taken = new Set(existing.map((n) => n.toLowerCase()));
    return files.map((f) => {
        const collides = taken.has(f.targetName.toLowerCase());
        taken.add(f.targetName.toLowerCase());
        return collides
            ? { ...f, collides, requestedName: f.requestedName ?? f.targetName }
            : { ...f, collides, choice: undefined, requestedName: undefined };
    });
}

/** Names that a rename must avoid: live files + other batch targets that will be written. */
export function reservedNames(files: PlannedFile[], existing: string[], exceptId: string): string[] {
    const names = [...existing];
    for (const f of files) {
        if (f.id === exceptId || f.choice === "skip") continue;
        names.push(f.targetName);
    }
    return names;
}

export function suggestRename(file: PlannedFile, files: PlannedFile[], existing: string[]): string {
    return nextAvailableName(file.requestedName ?? file.targetName, reservedNames(files, existing, file.id));
}

/** Set one file's decision: Replace writes the requested name, Rename prefills "name (1).ext". */
export function setChoice(files: PlannedFile[], id: string, choice: CollisionChoice, existing: string[]): PlannedFile[] {
    return files.map((x) => {
        if (x.id !== id) return x;
        const requested = x.requestedName ?? x.targetName;
        const base = { ...x, choice, targetName: requested };
        return choice === "rename" ? { ...base, targetName: suggestRename(base, files, existing) } : base;
    });
}

/** Live validation for the rename box. */
export function validateRename(name: string, file: PlannedFile, files: PlannedFile[], existing: string[], folder: string): string | undefined {
    const check = validateFileName(name, folder);
    if (!check.valid) return check.error;
    if (nameExists(name, reservedNames(files, existing, file.id))) return "A file with this name already exists.";
    return undefined;
}

/** "Apply to all": every colliding file gets the same decision; renames get fresh unique names. */
export function applyChoiceToAll(files: PlannedFile[], choice: CollisionChoice, existing: string[]): PlannedFile[] {
    let out = files.map((f) => (f.collides ? { ...f, choice, targetName: f.requestedName ?? f.targetName } : f));
    if (choice === "rename") {
        // assign sequentially so batch files do not take the same "(n)" name
        for (const f of out) {
            if (!f.collides) continue;
            const name = suggestRename(f, out, existing);
            out = out.map((x) => (x.id === f.id ? { ...x, targetName: name } : x));
        }
    }
    return out;
}

export function collisionsResolved(files: PlannedFile[], existing: string[], folder: string): boolean {
    return files.every((f) => {
        if (!f.collides) return true;
        if (!f.choice) return false;
        if (f.choice === "rename") return !validateRename(f.targetName, f, files, existing, folder);
        return true;
    });
}

/** Initial values for the pre-upload form: columnConfig default, else schema default for simple types. */
export function initialUploadValues(columns: ColumnModel[]): Record<string, EditValue> {
    const values: Record<string, EditValue> = {};
    for (const c of columns) {
        let v: EditValue = emptyValue(c.editor);
        const configured = c.defaultValue;
        const schemaDefault = c.field.defaultValue;
        const d = configured !== undefined ? configured : schemaDefault;
        if (d !== undefined && d !== null && d !== "") {
            switch (c.editor) {
                case "text":
                case "textarea":
                case "choice":
                    if (typeof d === "string") v = d;
                    break;
                case "multichoice":
                    if (Array.isArray(d)) v = d.map(String);
                    else if (typeof d === "string") v = d.split(";#").filter(Boolean);
                    break;
                case "number":
                    if (isFinite(Number(d))) v = Number(d);
                    break;
                case "boolean":
                    v = d === true || d === "1" || d === 1 || d === "true";
                    break;
                case "date":
                    if (typeof d === "string" && /^\d{4}-\d{2}-\d{2}/.test(d)) v = d.slice(0, 10);
                    break;
                default:
                    // complex defaults (people, terms, lookups) only via columnConfig objects of the right shape
                    if (configured !== undefined && typeof configured === "object") v = configured as EditValue;
            }
        }
        values[c.key] = v;
    }
    return values;
}

/** Form values for validateUpdateListItem after upload: content type + every non-empty collected value. */
export function uploadFormValues(
    columns: ColumnModel[],
    values: Record<string, EditValue>,
    contentType: ContentTypeInfo | undefined,
    includeContentType: boolean,
    regional: RegionalSettings,
): FormValue[] {
    const out: FormValue[] = [];
    if (contentType && includeContentType) out.push({ FieldName: "ContentType", FieldValue: contentType.name });
    for (const c of columns) {
        const v = values[c.key];
        if (!c.editable || isEmptyValue(c.editor, v)) continue;
        out.push({ FieldName: c.key, FieldValue: serializeValue(c.editor, v, regional) });
    }
    return out;
}
