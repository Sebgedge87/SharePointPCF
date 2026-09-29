import { SharePointRest, odataString } from "./spRest";
import { FieldSchema } from "../../model/fieldSchema";
import { LookupValue, PersonValue } from "../../model/values";
import { isAppError } from "../../utils/errors";

export interface Page<T> {
    items: T[];
    /** Absolute next-page URL (odata.nextLink); validated by the HTTP client on use. */
    next?: string;
}

const PAGE_SIZE = 20;

/** OData filter-safe text: single quotes doubled inside the literal. */
function substringFilter(fieldName: string, query: string): string {
    return `substringof(${odataString(query)},${fieldName})`;
}

/** Searchable, paged lookup options from the target list. */
export class LookupSearch {
    constructor(private readonly sp: SharePointRest) {}

    async search(field: FieldSchema, query: string, next?: string): Promise<Page<LookupValue>> {
        if (!field.lookupList) return { items: [] };
        const show = field.lookupField || "Title";
        type Row = Record<string, unknown> & { Id: number };
        let res: { value: Row[]; "odata.nextLink"?: string };
        if (next) {
            res = await this.sp.getAbsolute<typeof res>(next);
        } else {
            const base = `web/lists(guid'${field.lookupList}')/items?$select=Id,${encodeURIComponent(show)}&$top=${PAGE_SIZE}&$orderby=${encodeURIComponent(show)}`;
            const q = query.trim();
            try {
                res = await this.sp.get(q ? `${base}&$filter=${encodeURIComponent(substringFilter(show, q))}` : base);
            } catch (e) {
                // substringof is only valid on text columns: fall back to exact ID match for numeric lookups
                if (!q || !isAppError(e, "http")) throw e;
                const id = parseInt(q, 10);
                if (!isFinite(id)) return { items: [] };
                res = await this.sp.get(`web/lists(guid'${field.lookupList}')/items?$select=Id,${encodeURIComponent(show)}&$filter=Id eq ${id}`);
            }
        }
        return {
            items: res.value.map((r) => ({ id: r.Id, title: r[show] == null ? String(r.Id) : String(r[show]) })),
            next: res["odata.nextLink"],
        };
    }
}

interface PickerEntity {
    Key: string;
    DisplayText: string;
    EntityType?: string;
    IsResolved?: boolean;
    EntityData?: { Email?: string; Title?: string; Department?: string };
}

/** People via ClientPeoplePickerWebServiceInterface.clientPeoplePickerSearchUser. */
export class PeopleSearch {
    constructor(private readonly sp: SharePointRest) {}

    async search(field: FieldSchema, query: string, maxResults = 15): Promise<PersonValue[]> {
        const q = query.trim();
        if (q.length < 2) return [];
        const allowGroups = field.selectionMode === 1;
        const body = {
            queryParams: {
                QueryString: q,
                MaximumEntitySuggestions: maxResults,
                AllowEmailAddresses: false,
                AllowOnlyEmailAddresses: false,
                AllowMultipleEntities: !!field.allowMultipleValues,
                AllUrlZones: false,
                PrincipalSource: 15,
                // 1 = users; 15 = users + distribution lists + security groups + SharePoint groups
                PrincipalType: allowGroups ? 15 : 1,
                ...(field.selectionGroup ? { SharePointGroupID: field.selectionGroup } : {}),
            },
        };
        const res = await this.sp.post<{ value?: string; d?: { ClientPeoplePickerSearchUser?: string } }>(
            "SP.UI.ApplicationPages.ClientPeoplePickerWebServiceInterface.clientPeoplePickerSearchUser",
            body,
        );
        const raw = res?.value ?? res?.d?.ClientPeoplePickerSearchUser ?? "[]";
        return parsePickerEntities(raw);
    }
}

export function parsePickerEntities(raw: string): PersonValue[] {
    let entities: PickerEntity[];
    try {
        entities = JSON.parse(raw);
    } catch {
        return [];
    }
    if (!Array.isArray(entities)) return [];
    return entities
        .filter((e) => e && e.Key)
        .map((e) => ({ key: e.Key, displayText: e.DisplayText || e.Key, email: e.EntityData?.Email || undefined }));
}
