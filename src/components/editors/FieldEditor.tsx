import * as React from "react";
import { Checkbox, Combobox, Dropdown, Field, Input, Option, Textarea, makeStyles, tokens } from "@fluentui/react-components";
import { ColumnModel } from "../../model/columns";
import { EditValue, UrlValue } from "../../model/values";

const useStyles = makeStyles({
    field: { minWidth: "120px" },
    url: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalXXS },
});

export interface EditorProps<T extends EditValue = EditValue> {
    column: ColumnModel;
    value: T;
    onChange(value: T): void;
    disabled?: boolean;
}

/** Pickers that need services (lookup, people, taxonomy) are provided by the host. */
export type PickerRenderer = (props: EditorProps) => React.ReactNode;
export const PickerContext = React.createContext<Partial<Record<"lookup" | "user" | "taxonomy", PickerRenderer>>>({});

const TextEditor: React.FC<EditorProps<string>> = ({ column, value, onChange, disabled }) => (
    <Input
        size="small"
        value={value ?? ""}
        maxLength={column.field.maxLength ?? 255}
        disabled={disabled}
        aria-label={column.label}
        // empty string, never null
        onChange={(_, d) => onChange(d.value ?? "")}
    />
);

const NoteEditor: React.FC<EditorProps<string>> = ({ column, value, onChange, disabled }) => (
    <Textarea size="small" value={value ?? ""} disabled={disabled} aria-label={column.label} resize="vertical" onChange={(_, d) => onChange(d.value ?? "")} />
);

const ChoiceEditor: React.FC<EditorProps<string>> = ({ column, value, onChange, disabled }) => {
    const choices = column.field.choices ?? [];
    const options = !column.requiredBySchema ? ["", ...choices] : choices;
    if (column.field.fillInChoice) {
        return (
            <Combobox
                size="small"
                freeform
                disabled={disabled}
                aria-label={column.label}
                value={value ?? ""}
                selectedOptions={value ? [value] : []}
                onOptionSelect={(_, d) => onChange(d.optionValue ?? "")}
                onChange={(e) => onChange((e.target as HTMLInputElement).value)}
            >
                {choices.map((c) => (
                    <Option key={c} value={c}>
                        {c}
                    </Option>
                ))}
            </Combobox>
        );
    }
    return (
        <Dropdown
            size="small"
            disabled={disabled}
            aria-label={column.label}
            value={value ?? ""}
            selectedOptions={[value ?? ""]}
            onOptionSelect={(_, d) => onChange(d.optionValue ?? "")}
        >
            {options.map((c) => (
                <Option key={c || "__empty"} value={c} text={c || "(none)"}>
                    {c || "(none)"}
                </Option>
            ))}
        </Dropdown>
    );
};

const MultiChoiceEditor: React.FC<EditorProps<string[]>> = ({ column, value, onChange, disabled }) => {
    const selected = value ?? [];
    const choices = Array.from(new Set([...(column.field.choices ?? []), ...selected]));
    const [draft, setDraft] = React.useState("");
    const common = {
        size: "small" as const,
        multiselect: true,
        disabled,
        "aria-label": column.label,
        selectedOptions: selected,
        onOptionSelect: (_: unknown, d: { selectedOptions: string[] }) => onChange(d.selectedOptions),
    };
    const options = choices.map((c) => (
        <Option key={c} value={c}>
            {c}
        </Option>
    ));
    if (column.field.fillInChoice) {
        return (
            <Combobox
                {...common}
                freeform
                value={draft}
                placeholder={selected.join("; ")}
                onChange={(e) => setDraft((e.target as HTMLInputElement).value)}
                onKeyDown={(e) => {
                    if (e.key === "Enter" && draft.trim() && !selected.includes(draft.trim())) {
                        onChange([...selected, draft.trim()]);
                        setDraft("");
                    }
                }}
            >
                {options}
            </Combobox>
        );
    }
    return (
        <Dropdown {...common} value={selected.join("; ")}>
            {options}
        </Dropdown>
    );
};

function parseNumber(text: string): number | null | undefined {
    const t = text.trim().replace(/,/g, "");
    if (!t) return null;
    const n = Number(t);
    return isFinite(n) ? n : undefined;
}

const NumberEditor: React.FC<EditorProps<number | null>> = ({ column, value, onChange, disabled }) => {
    const [text, setText] = React.useState(value === null || value === undefined ? "" : String(value));
    React.useEffect(() => {
        // external reset (discard)
        if (parseNumber(text) !== value) setText(value === null || value === undefined ? "" : String(value));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [value]);
    const f = column.field;
    return (
        <Input
            size="small"
            inputMode="decimal"
            disabled={disabled}
            aria-label={column.label}
            value={text}
            contentAfter={f.showAsPercentage ? "%" : undefined}
            onChange={(_, d) => {
                setText(d.value);
                const n = parseNumber(d.value);
                // keep NaN so validation reports it instead of silently dropping input
                onChange(n === undefined ? NaN : n);
            }}
        />
    );
};

const DateEditor: React.FC<EditorProps<string | null>> = ({ column, value, onChange, disabled }) => (
    <Input
        size="small"
        type={column.editor === "datetime" ? "datetime-local" : "date"}
        disabled={disabled}
        aria-label={column.label}
        title="Site time zone"
        value={value ?? ""}
        onChange={(_, d) => onChange(d.value ? d.value : null)}
    />
);

const BooleanEditor: React.FC<EditorProps<boolean>> = ({ column, value, onChange, disabled }) => (
    <Checkbox checked={!!value} disabled={disabled} aria-label={column.label} onChange={(_, d) => onChange(d.checked === true)} />
);

const UrlEditor: React.FC<EditorProps<UrlValue | null>> = ({ column, value, onChange, disabled }) => {
    const styles = useStyles();
    const v = value ?? { url: "", description: "" };
    const set = (next: UrlValue) => onChange(next.url || next.description ? next : null);
    return (
        <div className={styles.url}>
            <Input size="small" type="url" placeholder="https://" disabled={disabled} aria-label={`${column.label} address`} value={v.url} onChange={(_, d) => set({ ...v, url: d.value })} />
            <Input size="small" placeholder="Description" disabled={disabled} aria-label={`${column.label} description`} value={v.description} onChange={(_, d) => set({ ...v, description: d.value })} />
        </div>
    );
};

/**
 * Editor registry: picks the editor for the column's EditorKind. Anything
 * without an editor renders `fallback` (the display value).
 */
export const FieldEditor: React.FC<EditorProps & { error?: string; fallback?: React.ReactNode }> = ({ error, fallback, ...props }) => {
    const styles = useStyles();
    const pickers = React.useContext(PickerContext);
    let editor: React.ReactNode;
    switch (props.column.editor) {
        case "filename":
        case "text":
            editor = <TextEditor {...(props as EditorProps<string>)} />;
            break;
        case "textarea":
            editor = <NoteEditor {...(props as EditorProps<string>)} />;
            break;
        case "choice":
            editor = <ChoiceEditor {...(props as EditorProps<string>)} />;
            break;
        case "multichoice":
            editor = <MultiChoiceEditor {...(props as EditorProps<string[]>)} />;
            break;
        case "number":
            editor = <NumberEditor {...(props as EditorProps<number | null>)} />;
            break;
        case "date":
        case "datetime":
            editor = <DateEditor {...(props as EditorProps<string | null>)} />;
            break;
        case "boolean":
            editor = <BooleanEditor {...(props as EditorProps<boolean>)} />;
            break;
        case "url":
            editor = <UrlEditor {...(props as EditorProps<UrlValue | null>)} />;
            break;
        case "lookup":
        case "lookupMulti":
            editor = pickers.lookup?.(props) ?? null;
            break;
        case "user":
        case "userMulti":
            editor = pickers.user?.(props) ?? null;
            break;
        case "taxonomy":
        case "taxonomyMulti":
            editor = pickers.taxonomy?.(props) ?? null;
            break;
        default:
            return <>{fallback}</>;
    }
    if (editor === null) return <>{fallback}</>;
    return (
        <Field className={styles.field} size="small" validationState={error ? "error" : "none"} validationMessage={error}>
            {editor}
        </Field>
    );
};
