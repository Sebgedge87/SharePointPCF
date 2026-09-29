import { HttpClient } from "../../src/services/httpClient";
import { scopeForUrl } from "../../src/services/auth/scopes";
import { SharePointRest } from "../../src/services/sharepoint/spRest";
import { fakeFetch, on } from "./fakeFetch";

export const SITE = "https://contoso.sharepoint.com/sites/crm";
export const LIB = "/sites/crm/contact";

export const FIELDS = [
    { Id: "1", InternalName: "FileLeafRef", Title: "Name", TypeAsString: "File", Required: true },
    { Id: "2", InternalName: "Title", Title: "Title", TypeAsString: "Text", MaxLength: 255 },
    { Id: "3", InternalName: "DocType", Title: "Document type", TypeAsString: "Choice", Required: true, Choices: ["Contract", "Letter"] },
    { Id: "4", InternalName: "Amount", Title: "Amount", TypeAsString: "Currency" },
    { Id: "5", InternalName: "Modified", Title: "Modified", TypeAsString: "DateTime", ReadOnlyField: true },
    { Id: "6", InternalName: "Mystery", Title: "Mystery", TypeAsString: "FancyNewType" },
];

export function spHandlers(extra: Parameters<typeof fakeFetch> = [], folderExists = true) {
    return fakeFetch(
        ...extra,
        on("GET", "GetFolderByServerRelativePath(decodedurl=@f)?@f", () => ({ Exists: folderExists })),
        on("GET", "web/GetList(@u)", () => ({
            Id: "list-1",
            Title: "Contact",
            EnableVersioning: true,
            ForceCheckout: false,
            RootFolder: { ServerRelativeUrl: LIB },
        })),
        on("GET", "/views/getbytitle(@v)", () => ({
            Id: "v1",
            Title: "Grid",
            ViewQuery: "",
            RowLimit: 30,
            ViewFields: { Items: ["DocIcon", "LinkFilename", "DocType", "Amount", "Modified", "Mystery"] },
        })),
        on("GET", "/fields?$filter=Hidden eq false", () => ({ value: FIELDS })),
        on("GET", "/contenttypes", () => ({
            value: [
                { StringId: "0x0101", Name: "Document", Hidden: false, FieldLinks: [{ Name: "Title", Required: true, Hidden: false }] },
                { StringId: "0x0120", Name: "Folder", Hidden: false, FieldLinks: [] },
            ],
        })),
        on("GET", "web/RegionalSettings?", () => ({ LocaleId: 2057, DateFormat: 1, DateSeparator: "/", DecimalSeparator: ".", ThousandSeparator: ",", Time24: true, TimeSeparator: ":" })),
    );
}

export function spFactory(fetchImpl: ReturnType<typeof fakeFetch>["fetch"]) {
    const http = new HttpClient({ tokenProvider: async () => "tok", scopeFor: scopeForUrl, fetchImpl, retry: { maxAttempts: 1 } });
    return (webUrl: string) => new SharePointRest(http, webUrl);
}
