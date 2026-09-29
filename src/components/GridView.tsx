import * as React from "react";
import { makeStyles, mergeClasses, Spinner, Text, tokens } from "@fluentui/react-components";
import { GridSession } from "../services/gridLoader";
import { AppServices } from "../services/appServices";
import { ResolvedFolder } from "../services/dataverse/folderResolver";
import { AppError } from "../utils/errors";
import { RenderRow } from "../services/sharepoint/items";
import { ColumnModel } from "../model/columns";
import { rowId } from "../model/display";
import { GridToolbar } from "./GridToolbar";
import { MetadataGrid, RowActions, fileUrl } from "./MetadataGrid";
import { useGridData } from "./useGridData";
import { useEditing } from "./useEditing";
import { FieldEditor } from "./editors/FieldEditor";
import { SaveBar } from "./SaveBar";
import { ErrorState } from "./StatusViews";
import { PickerProvider, PickerServices } from "./editors/Pickers";
import { LookupSearch, PeopleSearch } from "../services/sharepoint/pickers";
import { TermStoreClient } from "../services/graph/termStore";
import { DropZone } from "./DropZone";
import { UploadDialog, toPlanned } from "./UploadDialog";
import { PlannedFile } from "../model/uploadPlan";
import { DeleteDialog } from "./DeleteDialog";

const useStyles = makeStyles({
    dirty: { backgroundColor: tokens.colorPaletteYellowBackground1 },
    editing: { backgroundColor: tokens.colorNeutralBackground1Selected },
    rowError: { color: tokens.colorPaletteRedForeground1, display: "block" },
});

export interface GridViewProps {
    session: GridSession;
    services: AppServices;
    onPickLocation(folder: ResolvedFolder): void;
    onAuthError(e: AppError): void;
}

const AUTH_KINDS = new Set(["auth-required", "popup-blocked", "auth-cancelled", "auth-failed"]);

export const GridView: React.FC<GridViewProps> = ({ session, services, onPickLocation, onAuthError }) => {
    const styles = useStyles();
    const pickers: PickerServices = React.useMemo(
        () => ({
            lookups: new LookupSearch(session.sp),
            people: new PeopleSearch(session.sp),
            terms: services.http ? new TermStoreClient(services.http, session.sp) : undefined,
        }),
        [session, services],
    );
    const data = useGridData(session);
    const editing = useEditing(session, () => void data.reload());
    const locked = editing.dirtyCount > 0;
    const [pending, setPending] = React.useState<PlannedFile[]>();
    const [deleting, setDeleting] = React.useState<RenderRow>();
    const fileInput = React.useRef<HTMLInputElement>(null);

    React.useEffect(() => {
        const e = data.error ?? editing.error;
        if (e && AUTH_KINDS.has(e.kind)) onAuthError(e);
    }, [data.error, editing.error, onAuthError]);

    const actions: RowActions = React.useMemo(
        () => ({
            onOpen: (row: RenderRow) => window.open(fileUrl(session, row), "_blank", "noopener,noreferrer"),
            onEdit: (row: RenderRow) => void editing.startEdit(row),
            onDelete: (row: RenderRow) => setDeleting(row),
        }),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [session, editing.startEdit],
    );

    const renderCell = React.useCallback(
        (column: ColumnModel, row: RenderRow, display: React.ReactNode) => {
            const edit = editing.rows.get(rowId(row));
            if (!edit) return display;
            if (edit.loading) return column === session.columns[0] ? <Spinner size="extra-tiny" /> : display;
            const rowErr = column === session.columns[0] && edit.rowError ? <Text className={styles.rowError}>{edit.rowError}</Text> : null;
            // Read-only/system/calculated columns render but never enter edit mode.
            if (!column.editable || !(column.key in edit.current)) return <>{display}{rowErr}</>;
            return (
                <div onDoubleClick={(e) => e.stopPropagation()}>
                    <FieldEditor
                        column={column}
                        value={edit.current[column.key]}
                        onChange={(v) => editing.setValue(row, column.key, v)}
                        disabled={edit.saving}
                        error={edit.errors[column.key]}
                        fallback={display}
                    />
                    {rowErr}
                </div>
            );
        },
        [editing, session, styles.rowError],
    );

    return (
        <PickerProvider services={pickers}>
            <GridToolbar
                columns={session.columns}
                filters={data.filters}
                onFilters={data.setFilters}
                onRefresh={() => void data.reload()}
                candidates={session.candidates}
                current={session.folder}
                onPickLocation={onPickLocation}
                busy={data.loading || locked}
                onUploadClick={() => fileInput.current?.click()}
            />
            <input
                ref={fileInput}
                type="file"
                multiple
                hidden
                onChange={(e) => {
                    const files = Array.from(e.target.files ?? []);
                    e.target.value = "";
                    if (files.length) setPending(toPlanned(files));
                }}
            />
            <SaveBar dirtyCount={editing.dirtyCount} saving={editing.saving} onSave={() => void editing.saveAll()} onDiscard={editing.discardAll} />
            {editing.error && !AUTH_KINDS.has(editing.error.kind) && <ErrorState error={editing.error} />}
            <DropZone disabled={locked} onFiles={(files) => setPending(toPlanned(files))}>
                <MetadataGrid
                    session={session}
                    data={data}
                    actions={actions}
                    renderCell={renderCell}
                    locked={locked}
                    onRowDoubleClick={(row) => void editing.startEdit(row)}
                    rowClassName={(row) =>
                        editing.isDirty(row) ? mergeClasses(styles.dirty) : editing.isEditing(row) ? mergeClasses(styles.editing) : undefined
                    }
                />
            </DropZone>
            {deleting && (
                <DeleteDialog
                    row={deleting}
                    onConfirm={() => session.items.recycle(rowId(deleting))}
                    onClose={(deleted) => {
                        if (deleted) {
                            editing.cancelRow(deleting);
                            void data.reload();
                        }
                        setDeleting(undefined);
                    }}
                />
            )}
            {pending && (
                <UploadDialog
                    session={session}
                    files={pending}
                    onClose={(uploaded) => {
                        setPending(undefined);
                        if (uploaded) void data.reload();
                    }}
                />
            )}
        </PickerProvider>
    );
};
