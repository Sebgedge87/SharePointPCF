import { FieldSchema } from "../../model/fieldSchema";

/**
 * Sort and filter are done server-side by rewriting the view's CAML, never
 * client-side over one page of data.
 */
export interface SortSpec {
    field: string;
    ascending: boolean;
}

export type FilterOp = "contains" | "eq";

export interface FilterSpec {
    field: string;
    op: FilterOp;
    value: string;
}

export interface ViewXmlInput {
    viewFields: string[];
    /** The view's own inner CAML (ViewQuery). */
    viewQuery: string;
    rowLimit: number;
    fields: FieldSchema[];
    sort?: SortSpec;
    filters?: FilterSpec[];
}

/** Always requested: identity, file, and content type. */
export const REQUIRED_VIEW_FIELDS = ["ID", "FileLeafRef", "FileRef", "FileDirRef", "FSObjType", "ContentTypeId", "ContentType"];

export function escapeXml(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function extract(caml: string, tag: string): string | undefined {
    const m = new RegExp(`<${tag}(\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i").exec(caml);
    return m ? m[2] : undefined;
}

function extractElement(caml: string, tag: string): string | undefined {
    const m = new RegExp(`<${tag}(\\s[^>]*)?>[\\s\\S]*?</${tag}>|<${tag}(\\s[^>]*)?/>`, "i").exec(caml);
    return m ? m[0] : undefined;
}

/** CAML value type for a field. */
export function camlValueType(field: FieldSchema): string {
    switch (field.typeAsString) {
        case "Note":
        case "Text":
        case "Choice":
        case "MultiChoice":
        case "Number":
        case "Currency":
        case "Boolean":
        case "DateTime":
        case "URL":
        case "Computed":
            return field.typeAsString === "Computed" ? "Text" : field.typeAsString;
        case "User":
        case "UserMulti":
            return "User";
        case "Lookup":
        case "LookupMulti":
            return "Lookup";
        case "File":
            return "File";
        default:
            return "Text";
    }
}

/** Whether a column can be filtered with the simple filter bar. */
export function filterOpFor(field: FieldSchema): FilterOp | undefined {
    switch (field.typeAsString) {
        case "Text":
        case "File":
        case "Note":
            return field.richText ? undefined : "contains";
        case "Choice":
        case "MultiChoice":
        case "Boolean":
        case "Number":
        case "Currency":
            return "eq";
        case "User":
        case "UserMulti":
        case "Lookup":
        case "LookupMulti":
            return "contains";
        default:
            return undefined;
    }
}

function filterClause(f: FilterSpec, field: FieldSchema | undefined): string {
    const name = escapeXml(f.field);
    const type = field ? camlValueType(field) : "Text";
    let value = f.value;
    if (field?.typeAsString === "Boolean") value = /^(1|true|yes)$/i.test(value) ? "1" : "0";
    const tag = f.op === "contains" ? "Contains" : "Eq";
    return `<${tag}><FieldRef Name="${name}" /><Value Type="${type}">${escapeXml(value)}</Value></${tag}>`;
}

/** Nest n clauses into binary <And>s, as CAML requires. */
export function andAll(clauses: string[]): string | undefined {
    if (!clauses.length) return undefined;
    return clauses.reduce((acc, c) => `<And>${acc}${c}</And>`);
}

export function buildViewXml(input: ViewXmlInput): string {
    const byName = new Map(input.fields.map((f) => [f.internalName, f]));
    const where = extract(input.viewQuery, "Where");
    const filterClauses = (input.filters ?? []).filter((f) => f.value.trim() !== "").map((f) => filterClause(f, byName.get(f.field)));
    // Documents only (not folders), across subfolders of the record's folder.
    const docsOnly = `<Eq><FieldRef Name="FSObjType" /><Value Type="Integer">0</Value></Eq>`;
    const combined = andAll([...(where ? [where.trim()] : []), ...filterClauses, docsOnly]);

    let orderBy: string | undefined;
    if (input.sort) {
        orderBy = `<OrderBy Override="TRUE"><FieldRef Name="${escapeXml(input.sort.field)}" Ascending="${input.sort.ascending ? "TRUE" : "FALSE"}" /></OrderBy>`;
    } else {
        orderBy = extractElement(input.viewQuery, "OrderBy");
    }

    const fields = Array.from(new Set([...REQUIRED_VIEW_FIELDS, ...input.viewFields]));
    const viewFields = fields.map((f) => `<FieldRef Name="${escapeXml(f)}" />`).join("");
    const rowLimit = Math.max(1, Math.min(input.rowLimit || 30, 500));

    return (
        `<View Scope="Recursive">` +
        `<Query>${combined ? `<Where>${combined}</Where>` : ""}${orderBy ?? ""}</Query>` +
        `<ViewFields>${viewFields}</ViewFields>` +
        `<RowLimit Paged="TRUE">${rowLimit}</RowLimit>` +
        `</View>`
    );
}
