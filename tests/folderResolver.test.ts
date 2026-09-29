import { FolderResolver, ResolvedFolder, chainOrder, completePaths } from "../src/services/dataverse/folderResolver";
import { fakeDataverse, LT } from "./helpers/fakeDataverse";

const CONTACT = { entityName: "contact", id: "{AAAAAAAA-1111-2222-3333-444444444444}" };
const cid = "aaaaaaaa-1111-2222-3333-444444444444";

const site = (id: string, url: string, isdefault = false): Record<string, unknown> => ({ sharepointsiteid: id, absoluteurl: url, isdefault, statecode: 0 });
const loc = (id: string, name: string, relativeurl: string, parent: string, parentType: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
    sharepointdocumentlocationid: id,
    name,
    relativeurl,
    _parentsiteorlocation_value: parent,
    [`_parentsiteorlocation_value${LT}`]: parentType,
    statecode: 0,
    ...extra,
});

function standardTables() {
    return {
        sharepointsite: [site("s1", "https://contoso.sharepoint.com/sites/crm", true), site("s2", "https://contoso.sharepoint.com/sites/archive")],
        sharepointdocumentlocation: [
            loc("lib1", "Contact library", "contact", "s1", "sharepointsite"),
            loc("f1", "Documents on Default Site", "Jane Doe_ABC", "lib1", "sharepointdocumentlocation", { _regardingobjectid_value: cid }),
        ],
    };
}

describe("FolderResolver: documentLocation", () => {
    it("walks parents up to the site for the absolute URL", async () => {
        const { api } = fakeDataverse(standardTables());
        const r = await new FolderResolver(api).resolve(CONTACT, { folderMode: "documentLocation" });
        expect(r.chosen).toMatchObject({
            source: "documentLocation",
            webUrl: "https://contoso.sharepoint.com/sites/crm",
            libraryServerRelativeUrl: "/sites/crm/contact",
            folderServerRelativeUrl: "/sites/crm/contact/Jane Doe_ABC",
            absoluteFolderUrl: "https://contoso.sharepoint.com/sites/crm/contact/Jane%20Doe_ABC",
            locationId: "f1",
        });
        // queried by regarding id without braces, active only
        expect(api.retrieveMultipleRecords.mock.calls[0][1]).toContain(`_regardingobjectid_value eq ${cid} and statecode eq 0`);
    });

    it("handles nested locations", async () => {
        const t = standardTables();
        t.sharepointdocumentlocation.push(loc("sub", "Sub", "2024", "f1", "sharepointdocumentlocation", { _regardingobjectid_value: "other" }));
        t.sharepointdocumentlocation[1]._regardingobjectid_value = "none";
        t.sharepointdocumentlocation[2]._regardingobjectid_value = cid;
        const { api } = fakeDataverse(t);
        const r = await new FolderResolver(api).resolve(CONTACT, { folderMode: "documentLocation" });
        expect(r.chosen?.folderServerRelativeUrl).toBe("/sites/crm/contact/Jane Doe_ABC/2024");
        expect(r.chosen?.libraryServerRelativeUrl).toBe("/sites/crm/contact");
    });

    it("prefers the default site, then the configured library filter", async () => {
        const t = standardTables();
        t.sharepointdocumentlocation.push(
            loc("lib2", "Archive lib", "Shared Documents", "s2", "sharepointsite"),
            loc("f2", "Archive folder", "Jane", "lib2", "sharepointdocumentlocation", { _regardingobjectid_value: cid }),
        );
        // make the archive one older so plain order would pick it
        t.sharepointdocumentlocation.unshift(t.sharepointdocumentlocation.pop()!);
        const { api } = fakeDataverse(t);
        const resolver = new FolderResolver(api);

        const byDefault = await resolver.resolve(CONTACT, { folderMode: "documentLocation" });
        expect(byDefault.candidates).toHaveLength(2);
        expect(byDefault.chosen?.webUrl).toBe("https://contoso.sharepoint.com/sites/crm");

        const filtered = await resolver.resolve(CONTACT, { folderMode: "documentLocation", libraryName: "Shared Documents" });
        expect(filtered.chosen?.webUrl).toBe("https://contoso.sharepoint.com/sites/archive");

        const unmatched = await resolver.resolve(CONTACT, { folderMode: "documentLocation", libraryName: "Nope" });
        expect(unmatched.chosen?.webUrl).toBe("https://contoso.sharepoint.com/sites/crm");
        expect(unmatched.warnings[0]).toMatch(/No document location matched/);
    });

    it("falls through to template, then override, when there are no locations", async () => {
        const { api } = fakeDataverse({ sharepointdocumentlocation: [], contact: [{ contactid: cid, contactnumber: "CN-1" }] });
        const r = await new FolderResolver(api).resolve(CONTACT, {
            folderMode: "documentLocation",
            siteUrl: "https://contoso.sharepoint.com/sites/crm",
            fallbackTemplate: "{library}/{contactnumber}",
            libraryName: "contact",
        });
        expect(r.chosen?.source).toBe("template");
        expect(r.chosen?.folderServerRelativeUrl).toBe("/sites/crm/contact/CN-1");
        expect(r.attempts[0]).toMatch(/no active document locations/);
    });

    it("continues the chain when verification fails", async () => {
        const { api } = fakeDataverse(standardTables());
        const override = "https://contoso.sharepoint.com/sites/crm/contact/Manual";
        const verify = async (f: ResolvedFolder) => (f.source === "override" ? completePaths(f, "https://contoso.sharepoint.com/sites/crm") : undefined);
        const r = await new FolderResolver(api).resolve(CONTACT, { folderMode: "documentLocation", folderUrlOverride: override }, verify);
        expect(r.chosen?.source).toBe("override");
        expect(r.attempts.some((a) => a.includes("does not exist"))).toBe(true);
    });

    it("returns nothing (with attempts) when nothing resolves", async () => {
        const { api } = fakeDataverse({ sharepointdocumentlocation: [] });
        const r = await new FolderResolver(api).resolve(CONTACT, { folderMode: "documentLocation" });
        expect(r.chosen).toBeUndefined();
        expect(r.attempts).toHaveLength(3);
    });

    it("uses RetrieveAbsoluteAndSiteCollectionUrl when the walk fails", async () => {
        const t = standardTables();
        t.sharepointsite = []; // parent site missing
        const { api } = fakeDataverse(t);
        const abs = jest.fn(async () => ({
            absoluteUrl: "https://contoso.sharepoint.com/sites/crm/contact/Jane%20Doe_ABC",
            siteCollectionUrl: "https://contoso.sharepoint.com/sites/crm",
        }));
        const r = await new FolderResolver(api, abs).resolve(CONTACT, { folderMode: "documentLocation" });
        expect(abs).toHaveBeenCalledWith("f1");
        expect(r.chosen?.absoluteFolderUrl).toBe("https://contoso.sharepoint.com/sites/crm/contact/Jane%20Doe_ABC");
        expect(r.chosen?.webUrl).toBeUndefined(); // resolved against SharePoint later
    });

    it("rejects locations that point outside SharePoint Online", async () => {
        const t = standardTables();
        t.sharepointsite[0].absoluteurl = "https://sharepoint.evil.com/sites/crm";
        const { api } = fakeDataverse(t);
        const r = await new FolderResolver(api).resolve(CONTACT, { folderMode: "documentLocation" });
        expect(r.chosen).toBeUndefined();
        expect(r.warnings[0]).toMatch(/not an allowed host/);
    });
});

describe("FolderResolver: template", () => {
    const tables = () => ({
        contact: [
            {
                contactid: cid,
                contactnumber: "CN/0042",
                lastname: "",
                _parentcustomerid_value: "acc-1",
                "_parentcustomerid_value@OData.Community.Display.V1.FormattedValue": "Fabrikam: Ltd",
            },
        ],
    });

    it("fills tokens from the record and sanitises them into single segments", async () => {
        const { api } = fakeDataverse(tables());
        const resolver = new FolderResolver(api);
        await expect(resolver.expandTemplate("{library}/{contactnumber}", CONTACT, { libraryName: "contact" })).resolves.toBe("contact/CN_0042");
        await expect(resolver.expandTemplate("docs/{_parentcustomerid_value@formatted}/{recordidN}", CONTACT, {})).resolves.toBe(
            "docs/Fabrikam_ Ltd/AAAAAAAA111122223333444444444444",
        );
        expect(api.retrieveRecord).toHaveBeenCalledWith("contact", cid, "?$select=_parentcustomerid_value");
    });

    it("fails clearly on empty tokens and bad templates", async () => {
        const { api } = fakeDataverse(tables());
        const resolver = new FolderResolver(api);
        await expect(resolver.expandTemplate("{library}/{lastname}", CONTACT, { libraryName: "x" })).rejects.toThrow(/lastname.*empty/);
        await expect(resolver.expandTemplate("{recordid}", CONTACT, {})).rejects.toThrow(/library\/folder/);
        await expect(resolver.expandTemplate("x/{bad token}", CONTACT, {})).rejects.toThrow(/invalid template token/);
    });

    it("marks a missing template folder for creation only when allowed", async () => {
        const { api } = fakeDataverse({ ...tables(), sharepointdocumentlocation: [] });
        const settings = { folderMode: "template" as const, siteUrl: "https://contoso.sharepoint.com/sites/crm", fallbackTemplate: "contact/{contactnumber}" };
        const never = async () => undefined;
        const resolver = new FolderResolver(api);
        expect((await resolver.resolve(CONTACT, settings, never, false)).chosen).toBeUndefined();
        const r = await resolver.resolve(CONTACT, settings, never, true);
        expect(r.chosen?.needsCreate).toBe(true);
        expect(r.chosen?.folderServerRelativeUrl).toBe("/sites/crm/contact/CN_0042");
    });

    it("writes a matching sharepointdocumentlocation row", async () => {
        const { api, created } = fakeDataverse({
            sharepointsite: [site("s1", "https://contoso.sharepoint.com/sites/crm/")],
            sharepointdocumentlocation: [loc("lib1", "Contact", "contact", "s1", "sharepointsite")],
        });
        const resolver = new FolderResolver(api);
        const folder = completePaths(
            { source: "template", absoluteFolderUrl: "https://contoso.sharepoint.com/sites/crm/contact/CN_1", folderServerRelativeUrl: "", label: "x" },
            "https://contoso.sharepoint.com/sites/crm",
        );
        await resolver.createLocationRow(CONTACT, folder, "contacts");
        expect(created).toEqual([
            {
                entity: "sharepointdocumentlocation",
                data: {
                    name: "CN_1",
                    relativeurl: "CN_1",
                    "parentsiteorlocation_sharepointdocumentlocation@odata.bind": "/sharepointdocumentlocations(lib1)",
                    "regardingobjectid_contact@odata.bind": `/contacts(${cid})`,
                },
            },
        ]);
    });
});

describe("FolderResolver: override", () => {
    it("validates the override against the allowlist", async () => {
        const { api } = fakeDataverse({});
        const resolver = new FolderResolver(api);
        await expect(resolver.resolve(CONTACT, { folderMode: "override", folderUrlOverride: "https://evil.com/sites/x/lib/f" })).rejects.toMatchObject({
            kind: "host-not-allowed",
        });
        const ok = await resolver.resolve(CONTACT, {
            folderMode: "override",
            folderUrlOverride: "https://contoso.sharepoint.com/sites/crm/Shared%20Documents/A",
            siteUrl: "https://contoso.sharepoint.com/sites/crm",
        });
        expect(ok.chosen).toMatchObject({ libraryServerRelativeUrl: "/sites/crm/Shared Documents", folderServerRelativeUrl: "/sites/crm/Shared Documents/A" });
    });

    it("orders the chain with the configured mode first", () => {
        expect(chainOrder("override")).toEqual(["override", "documentLocation", "template"]);
        expect(chainOrder("template")).toEqual(["template", "documentLocation", "override"]);
    });

    it("completePaths rejects folders outside the site", () => {
        const f = { source: "override" as const, absoluteFolderUrl: "https://contoso.sharepoint.com/sites/other/lib/x", folderServerRelativeUrl: "", label: "" };
        expect(() => completePaths(f, "https://contoso.sharepoint.com/sites/crm")).toThrow(/not inside the site/);
        expect(() => completePaths(f, "https://fabrikam.sharepoint.com/sites/other")).toThrow(/host/);
    });
});
