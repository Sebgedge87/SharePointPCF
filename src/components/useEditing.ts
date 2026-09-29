import * as React from "react";
import { GridSession } from "../services/gridLoader";
import { FormValue, RenderRow } from "../services/sharepoint/items";
import { EditValue, serializeValue, valuesEqual } from "../model/values";
import { validateAll } from "../model/validation";
import { rowId } from "../model/display";
import { AppError } from "../utils/errors";
import { toAppError } from "./useGridData";

export interface RowEdit {
    row: RenderRow;
    original: Record<string, EditValue>;
    current: Record<string, EditValue>;
    loading: boolean;
    saving: boolean;
    /** Cell errors: client validation or validateUpdateListItem per-field results. */
    errors: Record<string, string>;
    rowError?: string;
}

export interface Editing {
    rows: Map<number, RowEdit>;
    dirtyCount: number;
    saving: boolean;
    isEditing(row: RenderRow): boolean;
    isDirty(row: RenderRow): boolean;
    startEdit(row: RenderRow): Promise<void>;
    cancelRow(row: RenderRow): void;
    setValue(row: RenderRow, key: string, value: EditValue): void;
    saveAll(): Promise<boolean>;
    discardAll(): void;
    error?: AppError;
}

export function changedValues(edit: RowEdit): Record<string, EditValue> {
    const out: Record<string, EditValue> = {};
    for (const [k, v] of Object.entries(edit.current)) {
        if (!valuesEqual(v, edit.original[k])) out[k] = v;
    }
    return out;
}

/**
 * Dirty-row tracking for inline edit. Only changed fields are sent, one
 * validateUpdateListItem call per row; per-field failures stay on the cell.
 */
export function useEditing(session: GridSession, onSaved: () => void): Editing {
    const [rows, setRows] = React.useState<Map<number, RowEdit>>(new Map());
    const [saving, setSaving] = React.useState(false);
    const [error, setError] = React.useState<AppError>();

    const update = (id: number, fn: (e: RowEdit) => RowEdit | undefined) =>
        setRows((prev) => {
            const cur = prev.get(id);
            if (!cur) return prev;
            const next = new Map(prev);
            const v = fn(cur);
            if (v) next.set(id, v);
            else next.delete(id);
            return next;
        });

    const startEdit = async (row: RenderRow) => {
        const id = rowId(row);
        if (rows.has(id)) return;
        const editable = session.columns.filter((c) => c.editable);
        if (!editable.length) return;
        setRows((prev) => new Map(prev).set(id, { row, original: {}, current: {}, loading: true, saving: false, errors: {} }));
        try {
            const values = await session.items.getEditValues(id, editable, row);
            update(id, (e) => ({ ...e, original: values, current: { ...values }, loading: false }));
        } catch (e) {
            update(id, () => undefined);
            setError(toAppError(e));
        }
    };

    const setValue = (row: RenderRow, key: string, value: EditValue) => {
        update(rowId(row), (e) => {
            const errors = { ...e.errors };
            delete errors[key];
            return { ...e, current: { ...e.current, [key]: value }, errors, rowError: undefined };
        });
    };

    const dirtyEntries = () => Array.from(rows.entries()).filter(([, e]) => Object.keys(changedValues(e)).length > 0);

    const saveAll = async (): Promise<boolean> => {
        setError(undefined);
        const dirty = dirtyEntries();
        if (!dirty.length) return true;
        const cols = new Map(session.columns.map((c) => [c.key, c]));

        // client validation first
        let invalid = false;
        for (const [id, e] of dirty) {
            const changed = changedValues(e);
            const errors = validateAll(
                session.columns.filter((c) => c.key in changed),
                changed,
                { mode: "edit", folderServerRelativeUrl: String(e.row.FileDirRef ?? session.folder.folderServerRelativeUrl), originalFileName: String(e.row.FileLeafRef ?? "") },
            );
            if (Object.keys(errors).length) {
                invalid = true;
                update(id, (r) => ({ ...r, errors: { ...r.errors, ...errors } }));
            }
        }
        if (invalid) return false;

        setSaving(true);
        let allOk = true;
        try {
            for (const [id, e] of dirty) {
                const changed = changedValues(e);
                const formValues: FormValue[] = Object.entries(changed).map(([key, v]) => ({
                    FieldName: key,
                    FieldValue: serializeValue(cols.get(key)!.editor, v, session.regional),
                }));
                update(id, (r) => ({ ...r, saving: true }));
                try {
                    const outcome = await session.items.validateUpdate(id, formValues);
                    if (outcome.ok) {
                        update(id, () => undefined);
                    } else {
                        allOk = false;
                        update(id, (r) => ({
                            ...r,
                            saving: false,
                            errors: { ...r.errors, ...outcome.fieldErrors },
                            rowError: outcome.generalErrors.join(" ") || undefined,
                        }));
                    }
                } catch (err) {
                    allOk = false;
                    const appErr = toAppError(err);
                    update(id, (r) => ({ ...r, saving: false, rowError: appErr.message }));
                    if (appErr.kind !== "http") setError(appErr);
                }
            }
        } finally {
            setSaving(false);
        }
        onSaved();
        return allOk;
    };

    const dirtyCount = dirtyEntries().length;

    return {
        rows,
        dirtyCount,
        saving,
        error,
        isEditing: (row) => rows.has(rowId(row)),
        isDirty: (row) => {
            const e = rows.get(rowId(row));
            return !!e && Object.keys(changedValues(e)).length > 0;
        },
        startEdit,
        cancelRow: (row) => update(rowId(row), () => undefined),
        setValue,
        saveAll,
        discardAll: () => {
            setRows(new Map());
            setError(undefined);
        },
    };
}
