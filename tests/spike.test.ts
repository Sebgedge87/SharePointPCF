import { runSharePointSpike } from "../src/services/sharepoint/spike";
import { SharePointRest } from "../src/services/sharepoint/spRest";
import { HttpClient } from "../src/services/httpClient";
import { scopeForUrl } from "../src/services/auth/scopes";
import { fakeFetch, on } from "./helpers/fakeFetch";

describe("Phase 1 spike", () => {
    const site = "https://contoso.sharepoint.com/sites/crm";

    it("reads web + list and round-trips a write", async () => {
        const f = fakeFetch(
            on("GET", "/_api/web?$select", () => ({ Title: "CRM", Url: site })),
            on("GET", "getbytitle(@l)", () => ({ Title: "Contact", ItemCount: 3, RootFolder: { ServerRelativeUrl: "/sites/crm/contact" } })),
            on("POST", "AddUsingPath", () => ({})),
            on("POST", "recycle()", () => ({ value: "guid" })),
        );
        const sp = new SharePointRest(new HttpClient({ tokenProvider: async () => "t", scopeFor: scopeForUrl, fetchImpl: f.fetch }), site);
        const steps = await runSharePointSpike(sp, { libraryTitle: "Contact", write: true, newGuid: () => "g" });
        expect(steps.map((s) => s.ok)).toEqual([true, true, true, true]);
        expect(f.calls[2].url).toContain("@f='/sites/crm/contact'");
        expect(f.calls[2].url).toContain("@n='__pcf_spike_g.txt'");
    });

    it("reports a 403 without continuing", async () => {
        const f = fakeFetch(on("GET", "/_api/web", () => ({ error: { message: { value: "Access denied." } } }), 403));
        const sp = new SharePointRest(new HttpClient({ tokenProvider: async () => "t", scopeFor: scopeForUrl, fetchImpl: f.fetch }), site);
        const steps = await runSharePointSpike(sp, { libraryTitle: "Contact", write: true });
        expect(steps).toHaveLength(1);
        expect(steps[0].ok).toBe(false);
        expect(steps[0].detail).toContain("no-permission 403");
    });
});
