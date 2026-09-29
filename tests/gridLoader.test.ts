import { loadGridSession } from "../src/services/gridLoader";
import { FolderResolver } from "../src/services/dataverse/folderResolver";
import { fakeDataverse, LT } from "./helpers/fakeDataverse";
import { SITE, spFactory, spHandlers } from "./helpers/spFixture";
import { on } from "./helpers/fakeFetch";

const cid = "aaaaaaaa-1111-2222-3333-444444444444";
const record = { entityName: "contact", id: cid };

function dataverse(withLocation = true) {
    return fakeDataverse({
        sharepointsite: [{ sharepointsiteid: "s1", absoluteurl: SITE, isdefault: true, statecode: 0 }],
        sharepointdocumentlocation: [
            { sharepointdocumentlocationid: "lib1", name: "Contact", relativeurl: "contact", _parentsiteorlocation_value: "s1", [`_parentsiteorlocation_value${LT}`]: "sharepointsite", statecode: 0 },
            ...(withLocation
                ? [{ sharepointdocumentlocationid: "f1", name: "Jane", relativeurl: "Jane_1", _parentsiteorlocation_value: "lib1", [`_parentsiteorlocation_value${LT}`]: "sharepointdocumentlocation", _regardingobjectid_value: cid, statecode: 0 }]
                : []),
        ],
        contact: [{ contactid: cid, contactnumber: "CN-9" }],
    });
}

const base = (api: ReturnType<typeof dataverse>["api"], fetchImpl: ReturnType<typeof spHandlers>["fetch"]) => ({
    resolver: new FolderResolver(api),
    record,
    viewName: "Grid",
    autoCreateFolder: false,
    columnConfig: {},
    sharePoint: spFactory(fetchImpl),
    entitySetName: async () => "contacts",
});

describe("loadGridSession", () => {
    it("resolves the folder, verifies it and builds dynamic columns from the view", async () => {
        const { api } = dataverse();
        const sp = spHandlers();
        const s = await loadGridSession({ ...base(api, sp.fetch), settings: { folderMode: "documentLocation" } });
        expect(s.folder.folderServerRelativeUrl).toBe("/sites/crm/contact/Jane_1");
        expect(s.columns.map((c) => [c.key, c.editor])).toEqual([
            ["FileLeafRef", "filename"],
            ["DocType", "choice"],
            ["Amount", "number"],
            ["Modified", "readonly"],
            ["Mystery", "readonly"],
        ]);
        expect(s.contentTypes.map((c) => c.name)).toEqual(["Document"]);
        expect(s.regional.dateFormat).toBe(1);
        // folder verified before the schema calls
        expect(sp.calls.findIndex((c) => c.url.includes("GetFolderByServerRelativePath"))).toBeLessThan(
            sp.calls.findIndex((c) => c.url.includes("/views/")),
        );
    });

    it("shows folder-not-found when nothing exists", async () => {
        const { api } = dataverse();
        const sp = spHandlers([], false);
        await expect(loadGridSession({ ...base(api, sp.fetch), settings: { folderMode: "documentLocation" } })).rejects.toMatchObject({
            kind: "folder-not-found",
        });
    });

    it("auto-creates from the template and writes a location row when enabled", async () => {
        const { api, created } = dataverse(false);
        const sp = spHandlers([on("POST", "Folders/AddUsingPath", () => ({}))], false);
        const s = await loadGridSession({
            ...base(api, sp.fetch),
            autoCreateFolder: true,
            settings: { folderMode: "documentLocation", siteUrl: SITE, fallbackTemplate: "contact/{contactnumber}" },
        });
        expect(s.folder.folderServerRelativeUrl).toBe("/sites/crm/contact/CN-9");
        expect(sp.calls.some((c) => c.method === "POST" && c.url.includes("@f='/sites/crm/contact/CN-9'"))).toBe(true);
        expect(created).toHaveLength(1);
        expect(created[0].data).toMatchObject({ relativeurl: "CN-9", "regardingobjectid_contact@odata.bind": `/contacts(${cid})` });
    });

    it("surfaces a missing view as a config error", async () => {
        const { api } = dataverse();
        const sp = spHandlers([on("GET", "/views/getbytitle(@v)", () => ({ error: { message: { value: "not found" } } }), 404)]);
        await expect(loadGridSession({ ...base(api, sp.fetch), settings: { folderMode: "documentLocation" } })).rejects.toMatchObject({
            kind: "config",
            message: expect.stringContaining('View "Grid"'),
        });
    });

    it("propagates permission errors instead of trying the next mode", async () => {
        const { api } = dataverse();
        const sp = spHandlers([on("GET", "GetFolderByServerRelativePath", () => ({ error: { message: { value: "Access denied." } } }), 403)]);
        await expect(
            loadGridSession({ ...base(api, sp.fetch), settings: { folderMode: "documentLocation", folderUrlOverride: `${SITE}/contact/x` } }),
        ).rejects.toMatchObject({ kind: "no-permission" });
    });
});
