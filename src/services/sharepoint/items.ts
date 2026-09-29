import { SharePointRest, aliasQuery } from "./spRest";
import { ListInfo } from "./lists";
import { parseValidateResult, ValidateOutcome } from "./validateResult";
import { ColumnModel } from "../../model/columns";
import { EditValue, LookupValue, PersonValue, TermValue, UrlValue } from "../../model/values";
import { renderLookups, renderTerms } from "../../model/display";

export type RenderRow = Record<string, unknown>;

export interface RenderPage {
    rows: RenderRow[];
    /** Query string (no leading ?) for the next / previous page, from NextHref / PrevHref. */
    nextPage?: string;
    prevPage?: string;
    firstRow: number;
}

export interface FormValue {
    FieldName: string;
    FieldValue: string;
}

function pagingQuery(href: unknown): string | undefined {
    if (typeof href !== "string" || !href) return undefined;
    const q = href.startsWith("?") ? href.slice(1) : href.split("?")[1];
    return q || undefined;
}

export class ItemService {
    constructor(
        readonly sp: SharePointRest,
        readonly list: ListInfo,
    ) {}

    private get path(): string {
        return `web/lists(guid'${this.list.id}')`;
    }

    /** One page of rows via RenderListDataAsStream. `page` is the NextHref/PrevHref query. */
    async render(viewXml: string, folderServerRelativeUrl: string, page?: string): Promise<RenderPage> {
        const qs = page ? `?${page}` : "";
        const r = await this.sp.post<{ Row?: RenderRow[]; NextHref?: string; PrevHref?: string; FirstRow?: number }>(
            `${this.path}/RenderListDataAsStream${qs}`,
            {
                parameters: {
                    RenderOptions: 2, // ListData
                    ViewXml: viewXml,
                    FolderServerRelativeUrl: folderServerRelativeUrl,
                    AllowMultipleValueFilterForTaxonomyFields: true,
                },
            },
        );
        return {
            rows: r?.Row ?? [],
            nextPage: pagingQuery(r?.NextHref),
            prevPage: pagingQuery(r?.PrevHref),
            firstRow: r?.FirstRow ?? 1,
        };
    }

    /**
     * Raw values for editing (render data is display-formatted). Lookups and
     * taxonomy come from the render row (REST items() returns WssIds, not labels).
     */
    async getEditValues(itemId: number, columns: ColumnModel[], renderRow: RenderRow): Promise<Record<string, EditValue>> {
        const select = new Set<string>(["Id"]);
        const expand = new Set<string>();
        for (const c of columns) {
            if (!c.editable) continue;
            switch (c.editor) {
                case "user":
                case "userMulti":
                    select.add(`${c.key}/Name`);
                    select.add(`${c.key}/Title`);
                    select.add(`${c.key}/EMail`);
                    expand.add(c.key);
                    break;
                case "lookup":
                case "lookupMulti":
                case "taxonomy":
                case "taxonomyMulti":
                    break;
                default:
                    select.add(c.key);
            }
        }
        const q = `$select=${Array.from(select).join(",")}${expand.size ? `&$expand=${Array.from(expand).join(",")}` : ""}`;
        const raw = await this.sp.get<Record<string, unknown>>(`${this.path}/items(${itemId})?${q}`);

        const out: Record<string, EditValue> = {};
        const dateJobs: Promise<void>[] = [];
        for (const c of columns) {
            if (!c.editable) continue;
            const v = raw[c.key];
            switch (c.editor) {
                case "filename":
                case "text":
                case "textarea":
                case "choice":
                    out[c.key] = v == null ? "" : String(v);
                    break;
                case "multichoice":
                    out[c.key] = Array.isArray(v) ? v.map(String) : ((v as { results?: string[] })?.results ?? []);
                    break;
                case "number":
                    out[c.key] = typeof v === "number" ? v : v == null || v === "" ? null : Number(v);
                    break;
                case "boolean":
                    out[c.key] = v === true;
                    break;
                case "date":
                case "datetime":
                    out[c.key] = null;
                    if (typeof v === "string" && v) {
                        dateJobs.push(
                            this.utcToSiteLocal(v).then((local) => {
                                out[c.key] = c.editor === "date" ? local.slice(0, 10) : local.slice(0, 16);
                            }),
                        );
                    }
                    break;
                case "url": {
                    const u = v as { Url?: string; Description?: string } | null;
                    out[c.key] = u?.Url ? ({ url: u.Url, description: u.Description ?? "" } as UrlValue) : null;
                    break;
                }
                case "user":
                case "userMulti": {
                    const arr = (Array.isArray(v) ? v : v ? [v] : []) as { Name?: string; Title?: string; EMail?: string }[];
                    const people: PersonValue[] = arr
                        .filter((p) => p?.Name)
                        .map((p) => ({ key: p.Name!, displayText: p.Title ?? p.Name!, email: p.EMail }));
                    out[c.key] = c.editor === "user" ? (people[0] ?? null) : people;
                    break;
                }
                case "lookup":
                case "lookupMulti": {
                    const lookups: LookupValue[] = renderLookups(renderRow[c.key]);
                    out[c.key] = c.editor === "lookup" ? (lookups[0] ?? null) : lookups;
                    break;
                }
                case "taxonomy":
                case "taxonomyMulti": {
                    const terms: TermValue[] = renderTerms(renderRow[c.key]);
                    out[c.key] = c.editor === "taxonomy" ? (terms[0] ?? null) : terms;
                    break;
                }
            }
        }
        await Promise.all(dateJobs);
        return out;
    }

    /** UTC ISO -> site wall-clock "YYYY-MM-DDTHH:mm:ss" (exact, including DST). */
    async utcToSiteLocal(isoUtc: string): Promise<string> {
        const r = await this.sp.get<{ value: string }>(`web/RegionalSettings/TimeZone/utcToLocalTime(@d)${aliasQuery({ d: isoUtc })}`);
        return (r?.value ?? isoUtc).replace(/Z$/, "");
    }

    async validateUpdate(itemId: number, formValues: FormValue[], opts: { newDocument?: boolean; checkInComment?: string } = {}): Promise<ValidateOutcome> {
        const body: Record<string, unknown> = {
            formValues,
            bNewDocumentUpdate: !!opts.newDocument,
        };
        if (opts.checkInComment !== undefined) body.checkInComment = opts.checkInComment;
        const r = await this.sp.post(`${this.path}/items(${itemId})/ValidateUpdateListItem()`, body);
        return parseValidateResult(r);
    }

    async recycle(itemId: number): Promise<void> {
        await this.sp.post(`${this.path}/items(${itemId})/recycle()`);
    }
}
