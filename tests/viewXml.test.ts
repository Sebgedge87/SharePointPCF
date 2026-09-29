import { andAll, buildViewXml, escapeXml } from "../src/services/sharepoint/viewXml";
import { field } from "./helpers/fields";

describe("buildViewXml", () => {
    const fields = [field("Title", "Text"), field("DocType", "Choice"), field("Signed", "Boolean")];
    const viewQuery = `<OrderBy><FieldRef Name="Modified" Ascending="FALSE" /></OrderBy><Where><Eq><FieldRef Name="DocType" /><Value Type="Choice">A</Value></Eq></Where>`;

    it("keeps the view's where + order, adds required fields and doc-only filter", () => {
        const xml = buildViewXml({ viewFields: ["Title", "DocType"], viewQuery, rowLimit: 50, fields });
        expect(xml).toContain(`<OrderBy><FieldRef Name="Modified" Ascending="FALSE" /></OrderBy>`);
        expect(xml).toContain(
            `<Where><And><Eq><FieldRef Name="DocType" /><Value Type="Choice">A</Value></Eq><Eq><FieldRef Name="FSObjType" /><Value Type="Integer">0</Value></Eq></And></Where>`,
        );
        expect(xml).toContain(`<FieldRef Name="ID" />`);
        expect(xml).toContain(`<FieldRef Name="Title" />`);
        expect(xml).toContain(`<RowLimit Paged="TRUE">50</RowLimit>`);
    });

    it("rewrites sort and adds escaped filters server-side", () => {
        const xml = buildViewXml({
            viewFields: ["Title"],
            viewQuery,
            rowLimit: 30,
            fields,
            sort: { field: "Title", ascending: true },
            filters: [
                { field: "Title", op: "contains", value: `a<b & "c"` },
                { field: "Signed", op: "eq", value: "yes" },
                { field: "DocType", op: "eq", value: "" },
            ],
        });
        expect(xml).toContain(`<OrderBy Override="TRUE"><FieldRef Name="Title" Ascending="TRUE" /></OrderBy>`);
        expect(xml).not.toContain(`Name="Modified"`);
        expect(xml).toContain(`<Contains><FieldRef Name="Title" /><Value Type="Text">a&lt;b &amp; &quot;c&quot;</Value></Contains>`);
        expect(xml).toContain(`<Eq><FieldRef Name="Signed" /><Value Type="Boolean">1</Value></Eq>`);
        // 3 clauses: view where + title + signed + doc-only -> 3 nested Ands
        expect(xml.match(/<And>/g)).toHaveLength(3);
    });

    it("helpers", () => {
        expect(andAll([])).toBeUndefined();
        expect(andAll(["a", "b", "c"])).toBe("<And><And>ab</And>c</And>");
        expect(escapeXml(`'`)).toBe("&apos;");
    });
});
