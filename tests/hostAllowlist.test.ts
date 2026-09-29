import { assertAllowedUrl, isAllowedUrl, sharePointScopeFor } from "../src/services/auth/hostAllowlist";
import { scopeForUrl } from "../src/services/auth/scopes";
import { isAppError } from "../src/utils/errors";

describe("host allowlist", () => {
    it.each([
        "https://contoso.sharepoint.com/sites/crm",
        "https://contoso-my.sharepoint.com/personal/x",
        "https://CONTOSO.SharePoint.com",
        "https://graph.microsoft.com/v1.0/sites",
        "https://contoso.sharepoint.com:443/sites/a",
    ])("allows %s", (url) => expect(isAllowedUrl(url)).toBe(true));

    it.each([
        "http://contoso.sharepoint.com/sites/crm", // not https
        "https://sharepoint.com/sites/crm", // no tenant label
        "https://evilsharepoint.com", // suffix trick
        "https://contoso.sharepoint.com.evil.com/x",
        "https://a.b.sharepoint.com/x", // nested label
        "https://graph.microsoft.com.evil.com/",
        "https://evil.com/?u=https://contoso.sharepoint.com",
        "https://user:pw@contoso.sharepoint.com/",
        "https://contoso.sharepoint.com:8443/",
        "javascript:alert(1)",
        "/sites/crm",
        "",
    ])("rejects %s", (url) => expect(isAllowedUrl(url)).toBe(false));

    it("assertAllowedUrl throws a typed error", () => {
        try {
            assertAllowedUrl("https://evil.com", "folderUrlOverride");
            fail("should throw");
        } catch (e) {
            expect(isAppError(e, "host-not-allowed")).toBe(true);
        }
    });

    it("derives per-resource scopes", () => {
        expect(sharePointScopeFor("https://Contoso.sharepoint.com/sites/x")).toBe("https://contoso.sharepoint.com/.default");
        expect(scopeForUrl("https://graph.microsoft.com/v1.0/x")).toBe("https://graph.microsoft.com/TermStore.Read.All");
        expect(() => scopeForUrl("https://evil.com/")).toThrow();
    });
});
