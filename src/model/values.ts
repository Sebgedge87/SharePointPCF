import { EditorKind } from "./editorRegistry";
import { formatSiteDate, formatSiteNumber, RegionalSettings } from "./regional";

export interface LookupValue {
    id: number;
    title: string;
}
export interface PersonValue {
    /** Claims key: i:0#.f|membership|upn */
    key: string;
    displayText: string;
    email?: string;
}
export interface TermValue {
    label: string;
    termId: string;
}
export interface UrlValue {
    url: string;
    description: string;
}
/** Wall-clock date/time in the *site's* time zone: "YYYY-MM-DD" or "YYYY-MM-DDTHH:mm". */
export type SiteDateValue = string;

export type EditValue =
    | string
    | string[]
    | number
    | boolean
    | null
    | LookupValue
    | LookupValue[]
    | PersonValue
    | PersonValue[]
    | TermValue
    | TermValue[]
    | UrlValue;

export function emptyValue(editor: EditorKind): EditValue {
    switch (editor) {
        case "multichoice":
        case "lookupMulti":
        case "userMulti":
        case "taxonomyMulti":
            return [];
        case "boolean":
            return false;
        case "number":
        case "date":
        case "datetime":
        case "lookup":
        case "user":
        case "taxonomy":
        case "url":
            return null;
        default:
            return "";
    }
}

export function isEmptyValue(editor: EditorKind, v: EditValue | undefined): boolean {
    if (v === undefined || v === null) return true;
    if (Array.isArray(v)) return v.length === 0;
    if (typeof v === "string") return v.trim() === "";
    if (editor === "url") return !(v as UrlValue).url?.trim();
    // booleans are never "empty": false is a value
    return false;
}

export const PERSON_CLAIM_PREFIX = "i:0#.f|membership|";

export function personKeyFromUpn(upn: string): string {
    return upn.startsWith("i:") ? upn : `${PERSON_CLAIM_PREFIX}${upn}`;
}

/** "Label|guid" (single) or "Label|guid;Label|guid" (multi). Label cannot contain | or ;. */
export function serializeTerms(terms: TermValue[]): string {
    return terms
        .filter((t) => t && t.termId)
        .map((t) => `${t.label.replace(/[|;]/g, " ").trim()}|${t.termId}`)
        .join(";");
}

export function serializePeople(people: PersonValue[]): string {
    const list = people.filter((p) => p && p.key).map((p) => ({ Key: p.key }));
    return list.length ? JSON.stringify(list) : "";
}

export function serializeLookupIds(values: LookupValue[]): string {
    return values
        .filter((v) => v && v.id > 0)
        .map((v) => `${v.id};#`)
        .join(";#");
}

/** URL fields: "url, description"; commas in the URL are escaped by doubling. */
export function serializeUrl(v: UrlValue | null): string {
    if (!v || !v.url.trim()) return "";
    return `${v.url.trim().replace(/,/g, ",,")}, ${(v.description ?? "").trim()}`;
}

function parseSiteDate(v: SiteDateValue) {
    const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(v);
    if (!m) return undefined;
    return { year: +m[1], month: +m[2], day: +m[3], hour: m[4] ? +m[4] : 0, minute: m[5] ? +m[5] : 0 };
}

/**
 * Edit value -> validateUpdateListItem FieldValue string.
 * Empty string clears the field.
 */
export function serializeValue(editor: EditorKind, value: EditValue | undefined, regional: RegionalSettings): string {
    if (value === undefined || value === null) return "";
    switch (editor) {
        case "filename":
        case "text":
        case "textarea":
        case "choice":
            return String(value);
        case "multichoice":
            return (value as string[]).filter(Boolean).join(";#");
        case "number":
            return typeof value === "number" && isFinite(value) ? formatSiteNumber(value, regional) : "";
        case "date":
        case "datetime": {
            const parts = parseSiteDate(String(value));
            return parts ? formatSiteDate(parts, regional, editor === "datetime") : "";
        }
        case "boolean":
            return value ? "1" : "0";
        case "lookup":
            return (value as LookupValue).id > 0 ? String((value as LookupValue).id) : "";
        case "lookupMulti":
            return serializeLookupIds(value as LookupValue[]);
        case "user":
            return serializePeople([value as PersonValue]);
        case "userMulti":
            return serializePeople(value as PersonValue[]);
        case "taxonomy":
            return serializeTerms([value as TermValue]);
        case "taxonomyMulti":
            return serializeTerms(value as TermValue[]);
        case "url":
            return serializeUrl(value as UrlValue);
        case "readonly":
            throw new Error("read-only columns are never serialised");
    }
}

/** Shallow-structural equality for dirty tracking. */
export function valuesEqual(a: EditValue | undefined, b: EditValue | undefined): boolean {
    if (Number.isNaN(a) || Number.isNaN(b)) return false;
    return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}
