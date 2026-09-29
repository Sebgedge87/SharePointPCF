import * as React from "react";
import {
    Button,
    DataGrid,
    DataGridBody,
    DataGridCell,
    DataGridHeader,
    DataGridHeaderCell,
    DataGridRow,
    Link,
    Menu,
    MenuItem,
    MenuList,
    MenuPopover,
    MenuTrigger,
    TableColumnDefinition,
    TableColumnSizingOptions,
    Text,
    createTableColumn,
    makeStyles,
    tokens,
} from "@fluentui/react-components";
import { GridSession } from "../services/gridLoader";
import { RenderRow } from "../services/sharepoint/items";
import { ColumnModel } from "../model/columns";
import { displayFor, rowId } from "../model/display";
import { DisplayCell } from "./DisplayCell";
import { GridData } from "./useGridData";
import { ErrorState, Loading } from "./StatusViews";

const useStyles = makeStyles({
    wrap: { overflowX: "auto", minHeight: "120px" },
    pager: { display: "flex", alignItems: "center", gap: tokens.spacingHorizontalS, paddingBlock: tokens.spacingVerticalXS },
    empty: { padding: tokens.spacingVerticalL, color: tokens.colorNeutralForeground3 },
});

/** Column types SharePoint can order by. */
const UNSORTABLE = new Set(["Note", "MultiChoice", "UserMulti", "LookupMulti", "TaxonomyFieldTypeMulti", "URL"]);
export const isSortable = (c: ColumnModel) => !UNSORTABLE.has(c.field.typeAsString) && !c.field.allowMultipleValues;

export function fileUrl(session: GridSession, row: RenderRow): string {
    return `${session.sp.absolute(String(row.FileRef ?? ""))}?web=1`;
}

export interface RowActions {
    onOpen(row: RenderRow): void;
    onEdit?(row: RenderRow): void;
    onDelete?(row: RenderRow): void;
}

export interface MetadataGridProps {
    session: GridSession;
    data: GridData;
    actions: RowActions;
    /** Replaces the display cell (inline editing, Phase 3). */
    renderCell?: (column: ColumnModel, row: RenderRow, display: React.ReactNode) => React.ReactNode;
    /** Row highlight for dirty rows. */
    rowClassName?: (row: RenderRow) => string | undefined;
    /** Unsaved edits: paging and sorting are paused. */
    locked?: boolean;
    /** Double-click a row to edit it. */
    onRowDoubleClick?: (row: RenderRow) => void;
}

export const MetadataGrid: React.FC<MetadataGridProps> = ({ session, data, actions, renderCell, rowClassName, locked, onRowDoubleClick }) => {
    const styles = useStyles();

    const columns: TableColumnDefinition<RenderRow>[] = React.useMemo(() => {
        const cols = session.columns.map((col) =>
            createTableColumn<RenderRow>({
                columnId: col.key,
                // Sorting is server-side: rows arrive in order, so the client compare is a no-op.
                compare: () => 0,
                renderHeaderCell: () => col.label,
                renderCell: (row) => {
                    const display =
                        col.key === "FileLeafRef" ? (
                            <Link href={fileUrl(session, row)} target="_blank" rel="noopener noreferrer">
                                {String(row.FileLeafRef ?? "")}
                            </Link>
                        ) : (
                            <DisplayCell value={displayFor(col, row)} />
                        );
                    return renderCell ? renderCell(col, row, display) : display;
                },
            }),
        );
        cols.push(
            createTableColumn<RenderRow>({
                columnId: "__actions",
                renderHeaderCell: () => "",
                renderCell: (row) => (
                    <Menu>
                        <MenuTrigger disableButtonEnhancement>
                            <Button appearance="subtle" aria-label={`Actions for ${String(row.FileLeafRef ?? "")}`}>
                                …
                            </Button>
                        </MenuTrigger>
                        <MenuPopover>
                            <MenuList>
                                <MenuItem onClick={() => actions.onOpen(row)}>Open</MenuItem>
                                {actions.onEdit && <MenuItem onClick={() => actions.onEdit!(row)}>Edit</MenuItem>}
                                {actions.onDelete && <MenuItem onClick={() => actions.onDelete!(row)}>Delete</MenuItem>}
                            </MenuList>
                        </MenuPopover>
                    </Menu>
                ),
            }),
        );
        return cols;
    }, [session, actions, renderCell]);

    const sizing: TableColumnSizingOptions = React.useMemo(() => {
        const s: TableColumnSizingOptions = { __actions: { idealWidth: 48, minWidth: 48 } };
        for (const c of session.columns) s[c.key] = { minWidth: 80, idealWidth: c.key === "FileLeafRef" ? 240 : 150 };
        return s;
    }, [session]);

    const byKey = React.useMemo(() => new Map(session.columns.map((c) => [c.key, c])), [session]);

    return (
        <div>
            {data.error && <ErrorState error={data.error} onRetry={() => void data.reload()} />}
            <div className={styles.wrap}>
                <DataGrid
                    items={data.rows}
                    columns={columns}
                    getRowId={(r: RenderRow) => rowId(r)}
                    sortable
                    sortState={data.sort ? { sortColumn: data.sort.field, sortDirection: data.sort.ascending ? "ascending" : "descending" } : undefined}
                    onSortChange={(_, s) => {
                        const col = byKey.get(String(s.sortColumn));
                        if (!locked && col && isSortable(col)) data.setSort({ field: col.key, ascending: s.sortDirection === "ascending" });
                    }}
                    resizableColumns
                    columnSizingOptions={sizing}
                    size="small"
                    aria-label="SharePoint documents"
                >
                    <DataGridHeader>
                        <DataGridRow>{({ renderHeaderCell }) => <DataGridHeaderCell>{renderHeaderCell()}</DataGridHeaderCell>}</DataGridRow>
                    </DataGridHeader>
                    <DataGridBody<RenderRow>>
                        {({ item, rowId: id }) => (
                            <DataGridRow<RenderRow> key={id} className={rowClassName?.(item)} onDoubleClick={() => onRowDoubleClick?.(item)}>
                                {({ renderCell: rc }) => <DataGridCell focusMode="group">{rc(item)}</DataGridCell>}
                            </DataGridRow>
                        )}
                    </DataGridBody>
                </DataGrid>
                {!data.loading && !data.rows.length && !data.error && <Text className={styles.empty}>No documents in this folder.</Text>}
            </div>
            <div className={styles.pager}>
                <Button size="small" disabled={locked || !data.hasPrev || data.loading} onClick={data.prev}>
                    Previous
                </Button>
                <Text size={200}>Page {data.pageIndex + 1}</Text>
                <Button size="small" disabled={locked || !data.hasNext || data.loading} onClick={data.next}>
                    Next
                </Button>
                {data.loading && <Loading label="Loading…" />}
            </div>
        </div>
    );
};
