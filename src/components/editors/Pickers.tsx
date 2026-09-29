import * as React from "react";
import { EditorProps, PickerContext, PickerRenderer } from "./FieldEditor";
import { AsyncPicker, PickerPage } from "./AsyncPicker";
import { LookupSearch, PeopleSearch } from "../../services/sharepoint/pickers";
import { TermStoreClient, TermNode, searchTerms } from "../../services/graph/termStore";
import { LookupValue, PersonValue, TermValue } from "../../model/values";
import { isMultiEditor } from "../../model/editorRegistry";

export interface PickerServices {
    lookups: LookupSearch;
    people: PeopleSearch;
    terms?: TermStoreClient;
}

const asList = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : v ? [v as T] : []);

function emit<T>(props: EditorProps, selected: T[]) {
    const multi = isMultiEditor(props.column.editor);
    props.onChange((multi ? selected : (selected[0] ?? null)) as never);
}

const LookupEditor: React.FC<EditorProps & { svc: LookupSearch }> = ({ svc, ...props }) => {
    const field = props.column.field;
    const toPage = React.useCallback(
        (p: { items: LookupValue[]; next?: string }): PickerPage<LookupValue> => ({
            items: p.items,
            more: p.next ? () => svc.search(field, "", p.next).then(toPage) : undefined,
        }),
        [svc, field],
    );
    return (
        <AsyncPicker<LookupValue>
            label={props.column.label}
            multi={isMultiEditor(props.column.editor)}
            selected={asList<LookupValue>(props.value)}
            onChange={(s) => emit(props, s)}
            search={(q) => svc.search(field, q).then(toPage)}
            keyOf={(v) => String(v.id)}
            labelOf={(v) => v.title}
            disabled={props.disabled}
        />
    );
};

const PeopleEditor: React.FC<EditorProps & { svc: PeopleSearch }> = ({ svc, ...props }) => (
    <AsyncPicker<PersonValue>
        label={props.column.label}
        multi={isMultiEditor(props.column.editor)}
        selected={asList<PersonValue>(props.value)}
        onChange={(s) => emit(props, s)}
        search={(q) => svc.search(props.column.field, q).then((items) => ({ items }))}
        keyOf={(v) => v.key}
        labelOf={(v) => v.displayText}
        secondaryOf={(v) => v.email}
        minChars={2}
        placeholder="Search people…"
        disabled={props.disabled}
    />
);

const TermEditor: React.FC<EditorProps & { svc?: TermStoreClient }> = ({ svc, ...props }) => {
    const { termSetId, anchorId } = props.column.field;
    const load = React.useCallback(async (q: string): Promise<PickerPage<TermNode>> => {
        if (!svc || !termSetId) throw new Error("This column has no term set.");
        return { items: searchTerms(await svc.getTerms(termSetId, anchorId), q) };
    }, [svc, termSetId, anchorId]);
    return (
        <AsyncPicker<TermValue>
            label={props.column.label}
            multi={isMultiEditor(props.column.editor)}
            selected={asList<TermValue>(props.value)}
            onChange={(s) => emit(props, s.map((t) => ({ label: t.label, termId: t.termId })))}
            search={load}
            keyOf={(v) => v.termId}
            labelOf={(v) => v.label}
            secondaryOf={(v) => {
                const path = (v as TermNode).path;
                return path && path !== v.label ? path : undefined;
            }}
            placeholder="Search terms…"
            disabled={props.disabled}
        />
    );
};

/** Provides lookup / people / term editors to the editor registry. */
export const PickerProvider: React.FC<{ services: PickerServices; children: React.ReactNode }> = ({ services, children }) => {
    const value = React.useMemo<Partial<Record<"lookup" | "user" | "taxonomy", PickerRenderer>>>(
        () => ({
            lookup: (p) => <LookupEditor {...p} svc={services.lookups} />,
            user: (p) => <PeopleEditor {...p} svc={services.people} />,
            taxonomy: (p) => <TermEditor {...p} svc={services.terms} />,
        }),
        [services],
    );
    return <PickerContext.Provider value={value}>{children}</PickerContext.Provider>;
};
