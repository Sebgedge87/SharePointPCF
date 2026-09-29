import { LookupSearch, PeopleSearch, parsePickerEntities } from "../src/services/sharepoint/pickers";
import { TermStoreClient, searchTerms } from "../src/services/graph/termStore";
import { HttpClient } from "../src/services/httpClient";
import { scopeForUrl } from "../src/services/auth/scopes";
import { SharePointRest } from "../src/services/sharepoint/spRest";
import { fakeFetch, on } from "./helpers/fakeFetch";
import { field } from "./helpers/fields";
import { SITE, spFactory } from "./helpers/spFixture";

describe("LookupSearch", () => {
    const lookup = field("Customer", "Lookup", { LookupList: "{11111111-2222-3333-4444-555555555555}", LookupField: "Title" });

    it("searches the target list with an escaped substringof filter and pages via nextLink", async () => {
        const f = fakeFetch(
            on("GET", "$skiptoken", () => ({ value: [{ Id: 3, Title: "O'Neil 2" }] })),
            on("GET", "/items?", () => ({
                value: [{ Id: 1, Title: "O'Neil" }, { Id: 2, Title: null }],
                "odata.nextLink": `${SITE}/_api/web/lists(guid'x')/items?$skiptoken=Paged%3dTRUE`,
            })),
        );
        const svc = new LookupSearch(spFactory(f.fetch)(SITE));
        const page = await svc.search(lookup, "O'N");
        expect(f.calls[0].url).toContain("web/lists(guid'11111111-2222-3333-4444-555555555555')/items?$select=Id,Title&$top=20&$orderby=Title");
        expect(f.calls[0].url).toContain("$filter=substringof('O''N',Title)");
        expect(page.items).toEqual([{ id: 1, title: "O'Neil" }, { id: 2, title: "2" }]);
        const next = await svc.search(lookup, "", page.next);
        expect(next.items).toEqual([{ id: 3, title: "O'Neil 2" }]);
    });

    it("refuses a nextLink on another host", async () => {
        const f = fakeFetch();
        const svc = new LookupSearch(spFactory(f.fetch)(SITE));
        await expect(svc.search(lookup, "", "https://fabrikam.sharepoint.com/_api/x")).rejects.toMatchObject({ kind: "host-not-allowed" });
        await expect(svc.search(lookup, "", "https://evil.com/_api/x")).rejects.toMatchObject({ kind: "host-not-allowed" });
        expect(f.fetch).not.toHaveBeenCalled();
    });

    it("falls back to an ID match when the lookup column is not text", async () => {
        const f = fakeFetch(
            on("GET", "Id eq 42", () => ({ value: [{ Id: 42, Num: 7 }] })),
            on("GET", "substringof", () => ({ error: { message: { value: "bad filter" } } }), 400),
        );
        const svc = new LookupSearch(spFactory(f.fetch)(SITE));
        const r = await svc.search(field("N", "Lookup", { LookupList: "L", LookupField: "Num" }), "42");
        expect(r.items).toEqual([{ id: 42, title: "7" }]);
    });
});

describe("PeopleSearch", () => {
    it("calls clientPeoplePickerSearchUser and parses claims keys", async () => {
        const entities = [
            { Key: "i:0#.f|membership|jane@contoso.com", DisplayText: "Jane Doe", EntityType: "User", EntityData: { Email: "jane@contoso.com" } },
            { Key: "", DisplayText: "junk" },
        ];
        const f = fakeFetch(on("POST", "clientPeoplePickerSearchUser", () => ({ value: JSON.stringify(entities) })));
        const svc = new PeopleSearch(spFactory(f.fetch)(SITE));
        const people = await svc.search(field("Owner", "User", { SelectionMode: 0 }), "jan");
        expect(people).toEqual([{ key: "i:0#.f|membership|jane@contoso.com", displayText: "Jane Doe", email: "jane@contoso.com" }]);
        expect(f.calls[0].body).toMatchObject({ queryParams: { QueryString: "jan", PrincipalType: 1, AllowMultipleEntities: false } });

        await svc.search(field("Team", "UserMulti", { SelectionMode: 1, AllowMultipleValues: true, SelectionGroup: 9 }), "dev");
        expect(f.calls[1].body).toMatchObject({ queryParams: { PrincipalType: 15, AllowMultipleEntities: true, SharePointGroupID: 9 } });
    });

    it("needs 2+ characters and tolerates bad payloads", async () => {
        const f = fakeFetch();
        expect(await new PeopleSearch(spFactory(f.fetch)(SITE)).search(field("O", "User"), "j")).toEqual([]);
        expect(f.fetch).not.toHaveBeenCalled();
        expect(parsePickerEntities("not json")).toEqual([]);
        expect(parsePickerEntities("{}")).toEqual([]);
    });
});

describe("TermStoreClient", () => {
    const setId = "aaaaaaaa-0000-0000-0000-000000000001";
    const graphBase = "https://graph.microsoft.com/v1.0/sites/contoso.sharepoint.com,site-1,web-1/termStore/sets/" + setId;
    const label = (name: string) => ({ labels: [{ name: `${name} (fr)`, isDefault: false }, { name, isDefault: true }] });

    function setup(storage?: Map<string, string>) {
        const f = fakeFetch(
            on("GET", "/_api/site?", () => ({ Id: "site-1" })),
            on("GET", "/_api/web?", () => ({ Id: "web-1" })),
            on("GET", `${graphBase}/children?`, () => ({ value: [{ id: "t1", ...label("Finance") }, { id: "t2", ...label("HR") }] })),
            on("GET", `${graphBase}/terms/t1/children?page=2`, () => ({ value: [{ id: "t12", ...label("Budgets") }] })),
            on("GET", `${graphBase}/terms/t1/children?`, () => ({ value: [{ id: "t11", ...label("Invoices") }], "@odata.nextLink": `${graphBase}/terms/t1/children?page=2` })),
            on("GET", `${graphBase}/terms/t2/children?`, () => ({ value: [] })),
            on("GET", `/children`, () => ({ value: [] })),
        );
        const tokens: string[] = [];
        const http = new HttpClient({
            tokenProvider: async (scope) => {
                tokens.push(scope);
                return "t";
            },
            scopeFor: scopeForUrl,
            fetchImpl: f.fetch,
        });
        const store = storage ?? new Map<string, string>();
        const client = new TermStoreClient(http, new SharePointRest(http, SITE), {
            storage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v) },
        });
        return { f, client, tokens, store };
    }

    it("walks the set breadth-first with default labels and paths, using the Graph term store scope", async () => {
        const { client, tokens } = setup();
        const terms = await client.getTerms(setId);
        expect(terms).toEqual([
            { label: "Finance", termId: "t1", path: "Finance" },
            { label: "HR", termId: "t2", path: "HR" },
            { label: "Invoices", termId: "t11", path: "Finance > Invoices" },
            { label: "Budgets", termId: "t12", path: "Finance > Budgets" },
        ]);
        expect(tokens).toContain("https://graph.microsoft.com/TermStore.Read.All");
        expect(tokens).toContain("https://contoso.sharepoint.com/.default");
    });

    it("starts at the anchor term", async () => {
        const { client } = setup();
        const terms = await client.getTerms(setId, "t1");
        expect(terms.map((t) => t.path)).toEqual(["Invoices", "Budgets"]);
    });

    it("caches per session (memory and sessionStorage)", async () => {
        const { client, f, store } = setup();
        await client.getTerms(setId);
        const calls = f.calls.length;
        await client.getTerms(setId);
        expect(f.calls.length).toBe(calls);
        // a fresh client (e.g. after re-render) reuses sessionStorage
        const second = setup(store);
        await second.client.getTerms(setId);
        expect(second.f.calls.length).toBe(0);
    });

    it("search prefers label prefix matches", () => {
        const terms = [
            { label: "Budgets", termId: "1", path: "Finance > Budgets" },
            { label: "Finance", termId: "2", path: "Finance" },
            { label: "Fin tech", termId: "3", path: "Tech > Fin tech" },
        ];
        expect(searchTerms(terms, "fin").map((t) => t.termId)).toEqual(["2", "3", "1"]);
        expect(searchTerms(terms, "")).toHaveLength(3);
    });
});
