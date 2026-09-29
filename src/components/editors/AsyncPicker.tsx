import * as React from "react";
import { Combobox, Option, Spinner, Tag, TagGroup, Text, makeStyles, tokens } from "@fluentui/react-components";

const useStyles = makeStyles({
    root: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalXXS, minWidth: "180px" },
    secondary: { color: tokens.colorNeutralForeground3, marginInlineStart: tokens.spacingHorizontalXS },
});

export interface PickerPage<T> {
    items: T[];
    /** Load the next page (lookups). */
    more?: () => Promise<PickerPage<T>>;
}

export interface AsyncPickerProps<T> {
    label: string;
    multi: boolean;
    selected: T[];
    onChange(selected: T[]): void;
    search(query: string): Promise<PickerPage<T>>;
    keyOf(item: T): string;
    labelOf(item: T): string;
    secondaryOf?(item: T): string | undefined;
    minChars?: number;
    placeholder?: string;
    disabled?: boolean;
}

const LOAD_MORE = "__load_more__";

/**
 * Searchable picker shared by lookup, people and term editors: debounced
 * search, paged "load more", selected values as dismissible tags.
 */
export function AsyncPicker<T>(p: AsyncPickerProps<T>): React.ReactElement {
    const styles = useStyles();
    const [query, setQuery] = React.useState("");
    const [options, setOptions] = React.useState<T[]>([]);
    const [more, setMore] = React.useState<PickerPage<T>["more"]>();
    const [loading, setLoading] = React.useState(false);
    const [error, setError] = React.useState<string>();
    const seq = React.useRef(0);
    const searchRef = React.useRef(p.search);
    searchRef.current = p.search;
    const minChars = p.minChars ?? 0;

    const run = React.useCallback(
        (q: string) => {
            const id = ++seq.current;
            if (q.trim().length < minChars) {
                setOptions([]);
                setMore(undefined);
                return;
            }
            setLoading(true);
            setError(undefined);
            searchRef.current(q)
                .then((page) => {
                    if (id !== seq.current) return;
                    setOptions(page.items);
                    setMore(() => page.more);
                })
                .catch((e: Error) => id === seq.current && setError(e.message))
                .finally(() => id === seq.current && setLoading(false));
        },
        [minChars],
    );

    React.useEffect(() => {
        const t = setTimeout(() => run(query), 250);
        return () => clearTimeout(t);
    }, [query, run]);

    const loadMore = async () => {
        if (!more) return;
        setLoading(true);
        try {
            const page = await more();
            setOptions((o) => [...o, ...page.items]);
            setMore(() => page.more);
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setLoading(false);
        }
    };

    const selectedKeys = p.selected.map(p.keyOf);
    const byKey = new Map([...p.selected, ...options].map((o) => [p.keyOf(o), o]));

    return (
        <div className={styles.root}>
            {p.selected.length > 0 && (
                <TagGroup
                    size="extra-small"
                    aria-label={`${p.label} selected`}
                    onDismiss={(_, d) => !p.disabled && p.onChange(p.selected.filter((s) => p.keyOf(s) !== d.value))}
                >
                    {p.selected.map((s) => (
                        <Tag key={p.keyOf(s)} value={p.keyOf(s)} dismissible={!p.disabled} dismissIcon={{ "aria-label": "remove" }}>
                            {p.labelOf(s)}
                        </Tag>
                    ))}
                </TagGroup>
            )}
            <Combobox
                    size="small"
                    freeform
                    multiselect={p.multi}
                    disabled={p.disabled}
                    aria-label={p.label}
                    placeholder={p.placeholder ?? (minChars ? `Type ${minChars}+ characters…` : "Search…")}
                    value={query}
                    selectedOptions={selectedKeys}
                    onChange={(e) => setQuery((e.target as HTMLInputElement).value)}
                    onOptionSelect={(_, d) => {
                        if (d.optionValue === LOAD_MORE) {
                            void loadMore();
                            return;
                        }
                        const chosen = d.selectedOptions.map((k) => byKey.get(k)).filter((x): x is T => x !== undefined);
                        p.onChange(p.multi ? chosen : chosen.slice(-1));
                        setQuery("");
                    }}
                    expandIcon={loading ? <Spinner size="extra-tiny" /> : undefined}
                >
                    {options.map((o) => (
                        <Option key={p.keyOf(o)} value={p.keyOf(o)} text={p.labelOf(o)}>
                            {p.labelOf(o)}
                            {p.secondaryOf?.(o) && <Text size={200} className={styles.secondary}>{p.secondaryOf(o)}</Text>}
                        </Option>
                    ))}
                    {more && (
                        <Option key={LOAD_MORE} value={LOAD_MORE} text="Load more">
                            Load more…
                        </Option>
                    )}
                    {!loading && !options.length && query.trim().length >= minChars && (
                        <Option key="__none" value="__none" text="" disabled>
                            {error ? `Search failed: ${error}` : "No matches"}
                        </Option>
                    )}
            </Combobox>
        </div>
    );
}
