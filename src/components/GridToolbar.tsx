import * as React from "react";
import { Button, Dropdown, Input, Option, Toolbar, ToolbarDivider, Tooltip, makeStyles, tokens } from "@fluentui/react-components";
import { ColumnModel } from "../model/columns";
import { FilterSpec, filterOpFor } from "../services/sharepoint/viewXml";
import { ResolvedFolder } from "../services/dataverse/folderResolver";

const useStyles = makeStyles({
    bar: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: tokens.spacingHorizontalS, paddingBlock: tokens.spacingVerticalXS },
    grow: { flexGrow: 1 },
});

export interface GridToolbarProps {
    columns: ColumnModel[];
    filters: FilterSpec[];
    onFilters(filters: FilterSpec[]): void;
    onRefresh(): void;
    candidates: ResolvedFolder[];
    current: ResolvedFolder;
    onPickLocation(folder: ResolvedFolder): void;
    onUploadClick?: () => void;
    busy?: boolean;
}

/** Filter bar (one column + value, rewritten into the ViewXml server-side), location picker, refresh. */
export const GridToolbar: React.FC<GridToolbarProps> = (p) => {
    const styles = useStyles();
    const filterable = p.columns.filter((c) => filterOpFor(c.field));
    const active = p.filters[0];
    const [field, setField] = React.useState(active?.field ?? filterable[0]?.key ?? "");
    const [value, setValue] = React.useState(active?.value ?? "");
    const fieldCol = filterable.find((c) => c.key === field);

    const apply = () => {
        const op = fieldCol ? filterOpFor(fieldCol.field) : undefined;
        p.onFilters(op && value.trim() ? [{ field, op, value: value.trim() }] : []);
    };

    return (
        <Toolbar className={styles.bar} aria-label="Document grid toolbar">
            {p.onUploadClick && (
                <Button appearance="primary" onClick={p.onUploadClick} disabled={p.busy}>
                    Upload
                </Button>
            )}
            <Button onClick={p.onRefresh} disabled={p.busy}>
                Refresh
            </Button>
            {filterable.length > 0 && (
                <>
                    <ToolbarDivider />
                    <Dropdown
                        aria-label="Filter column"
                        value={fieldCol?.label ?? ""}
                        selectedOptions={field ? [field] : []}
                        onOptionSelect={(_, d) => setField(d.optionValue ?? "")}
                        style={{ minWidth: 140 }}
                    >
                        {filterable.map((c) => (
                            <Option key={c.key} value={c.key}>
                                {c.label}
                            </Option>
                        ))}
                    </Dropdown>
                    <Input
                        aria-label="Filter value"
                        placeholder={fieldCol && filterOpFor(fieldCol.field) === "eq" ? "equals…" : "contains…"}
                        value={value}
                        onChange={(_, d) => setValue(d.value)}
                        onKeyDown={(e) => e.key === "Enter" && apply()}
                    />
                    <Button onClick={apply}>Filter</Button>
                    {p.filters.length > 0 && (
                        <Button
                            appearance="subtle"
                            onClick={() => {
                                setValue("");
                                p.onFilters([]);
                            }}
                        >
                            Clear
                        </Button>
                    )}
                </>
            )}
            <span className={styles.grow} />
            {p.candidates.length > 1 && (
                <Tooltip content="This record has several document locations" relationship="description">
                    <Dropdown
                        aria-label="Document location"
                        value={p.current.label}
                        selectedOptions={[p.current.absoluteFolderUrl]}
                        onOptionSelect={(_, d) => {
                            const next = p.candidates.find((c) => c.absoluteFolderUrl === d.optionValue);
                            if (next && next !== p.current) p.onPickLocation(next);
                        }}
                    >
                        {p.candidates.map((c) => (
                            <Option key={c.absoluteFolderUrl} value={c.absoluteFolderUrl}>
                                {c.label}
                            </Option>
                        ))}
                    </Dropdown>
                </Tooltip>
            )}
        </Toolbar>
    );
};
