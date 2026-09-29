import { ColumnModel } from "./columns";
import { LookupValue, TermValue } from "./values";

/** What a read-only cell shows. Display values always come from render data. */
export type DisplayValue =
    | { kind: "text"; text: string }
    | { kind: "html"; html: string }
    | { kind: "link"; href: string; text: string };

const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : v === undefined || v === null || v === "" ? [] : [v]);

export function renderLookups(v: unknown): LookupValue[] {
    return asArray(v)
        .map((x) => x as { lookupId?: number | string; lookupValue?: string })
        .filter((x) => x && x.lookupId !== undefined && Number(x.lookupId) > 0)
        .map((x) => ({ id: Number(x.lookupId), title: String(x.lookupValue ?? "") }));
}

export function renderTerms(v: unknown): TermValue[] {
    return asArray(v)
        .map((x) => x as { Label?: string; TermID?: string })
        .filter((x) => x && x.TermID)
        .map((x) => ({ label: String(x.Label ?? ""), termId: String(x.TermID) }));
}

export function renderPeopleNames(v: unknown): string[] {
    return asArray(v)
        .map((x) => (x as { title?: string })?.title)
        .filter((t): t is string => !!t);
}

export function displayFor(column: ColumnModel, row: Record<string, unknown>): DisplayValue {
    const v = row[column.key];
    const f = column.field;
    switch (f.typeAsString) {
        case "Note":
            if (f.richText && typeof v === "string") return { kind: "html", html: v };
            break;
        case "URL": {
            const href = typeof v === "string" ? v : "";
            const desc = (row[`${column.key}.desc`] as string) || href;
            return href ? { kind: "link", href, text: desc } : { kind: "text", text: "" };
        }
        case "Lookup":
        case "LookupMulti":
            return { kind: "text", text: renderLookups(v).map((l) => l.title).join("; ") };
        case "User":
        case "UserMulti":
            return { kind: "text", text: renderPeopleNames(v).join("; ") };
        case "TaxonomyFieldType":
        case "TaxonomyFieldTypeMulti":
            return { kind: "text", text: renderTerms(v).map((t) => t.label).join("; ") };
        case "MultiChoice":
            if (Array.isArray(v)) return { kind: "text", text: v.join("; ") };
            break;
    }
    if (v === null || v === undefined) return { kind: "text", text: "" };
    if (Array.isArray(v)) return { kind: "text", text: v.map((x) => (typeof x === "object" ? JSON.stringify(x) : String(x))).join("; ") };
    if (typeof v === "object") {
        const o = v as Record<string, unknown>;
        return { kind: "text", text: String(o.Label ?? o.title ?? o.lookupValue ?? "") };
    }
    return { kind: "text", text: String(v) };
}

/** Sort key for the column header (server-side sort on the real field). */
export function rowId(row: Record<string, unknown>): number {
    return Number(row.ID ?? row.Id ?? 0);
}
