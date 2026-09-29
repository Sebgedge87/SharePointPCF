import { ItemService } from "../src/services/sharepoint/items";
import { buildColumns } from "../src/model/columns";
import { validateAll, validateValue } from "../src/model/validation";
import { changedValues } from "../src/components/useEditing";
import { field } from "./helpers/fields";
import { fakeFetch, on } from "./helpers/fakeFetch";
import { SITE, spFactory } from "./helpers/spFixture";

const fields = [
    field("FileLeafRef", "File"),
    field("Title", "Text", { MaxLength: 5 }),
    field("Notes", "Note"),
    field("DocType", "Choice", { Choices: ["A", "B"], Required: true }),
    field("Tags", "MultiChoice", { Choices: ["x", "y"], FillInChoice: true }),
    field("Amount", "Number", { MinimumValue: 0, MaximumValue: 100 }),
    field("Due", "DateTime", { DisplayFormat: 0 }),
    field("At", "DateTime", { DisplayFormat: 1 }),
    field("Signed", "Boolean"),
    field("Link", "URL"),
    field("Owner", "User"),
    field("Related", "Lookup", { LookupList: "{abc}", LookupField: "Title" }),
    field("Topic", "TaxonomyFieldType"),
    field("Calc", "Calculated"),
];
const { columns } = buildColumns(fields.map((f) => f.internalName), fields, {});
const col = (k: string) => columns.find((c) => c.key === k)!;

describe("ItemService.getEditValues (raw schema for edit)", () => {
    it("maps raw REST values, converts dates to site time, takes lookups/terms from render data", async () => {
        const f = fakeFetch(
            on("GET", "/items(7)?", () => ({
                Id: 7,
                FileLeafRef: "a.pdf",
                Title: null,
                Notes: "n",
                DocType: "A",
                Tags: ["x", "custom"],
                Amount: 12.5,
                Due: "2026-09-02T23:00:00Z",
                At: "2026-09-03T13:30:00Z",
                Signed: true,
                Link: { Url: "https://x.com", Description: "X" },
                Owner: { Name: "i:0#.f|membership|jane@contoso.com", Title: "Jane", EMail: "jane@contoso.com" },
            })),
            on("GET", "utcToLocalTime(@d)?@d='2026-09-02T23:00:00Z'", () => ({ value: "2026-09-03T00:00:00" })),
            on("GET", "utcToLocalTime(@d)?@d='2026-09-03T13:30:00Z'", () => ({ value: "2026-09-03T14:30:00" })),
        );
        const items = new ItemService(spFactory(f.fetch)(SITE), { id: "L", title: "Contact", rootFolderServerRelativeUrl: "/x", enableVersioning: true, forceCheckout: false });
        const row = {
            ID: "7",
            Related: [{ lookupId: 3, lookupValue: "Three" }],
            Topic: { Label: "Finance", TermID: "11111111-1111-1111-1111-111111111111" },
        };
        const v = await items.getEditValues(7, columns, row);
        expect(v).toEqual({
            FileLeafRef: "a.pdf",
            Title: "",
            Notes: "n",
            DocType: "A",
            Tags: ["x", "custom"],
            Amount: 12.5,
            Due: "2026-09-03",
            At: "2026-09-03T14:30",
            Signed: true,
            Link: { url: "https://x.com", description: "X" },
            Owner: { key: "i:0#.f|membership|jane@contoso.com", displayText: "Jane", email: "jane@contoso.com" },
            Related: { id: 3, title: "Three" },
            Topic: { label: "Finance", termId: "11111111-1111-1111-1111-111111111111" },
        });
        const itemsCall = f.calls[0].url;
        expect(itemsCall).toContain("$expand=Owner");
        expect(itemsCall).toContain("Owner/Name");
        expect(itemsCall).not.toContain("Calc");
        expect(itemsCall).not.toMatch(/[,=]Related[,&]/);
    });
});

describe("validation", () => {
    const ctx = { mode: "edit" as const, folderServerRelativeUrl: "/sites/crm/contact/x", originalFileName: "a.pdf" };
    it("checks each editor's constraints", () => {
        expect(validateValue(col("Title"), "123456", ctx)).toMatch(/5 characters/);
        expect(validateValue(col("Title"), "", ctx)).toBeUndefined();
        expect(validateValue(col("DocType"), "", ctx)).toBe("DocType is required.");
        expect(validateValue(col("DocType"), "C", ctx)).toMatch(/listed choices/);
        expect(validateValue(col("Tags"), ["x", "anything"], ctx)).toBeUndefined(); // fill-in allowed
        expect(validateValue(col("Amount"), 101, ctx)).toBe("Must be 100 or less.");
        expect(validateValue(col("Amount"), NaN, ctx)).toBe("Enter a number.");
        expect(validateValue(col("Due"), "2026-13", ctx)).toMatch(/valid date/);
        expect(validateValue(col("At"), "2026-09-03T10:00", ctx)).toBeUndefined();
        expect(validateValue(col("Link"), { url: "javascript:alert(1)", description: "" }, ctx)).toMatch(/https/);
        expect(validateValue(col("FileLeafRef"), "b.docx", ctx)).toBe("Keep the .pdf extension.");
        expect(validateValue(col("FileLeafRef"), "b?.pdf", ctx)).toMatch(/cannot contain/);
        expect(validateValue(col("FileLeafRef"), "b.pdf", ctx)).toBeUndefined();
        expect(validateValue(col("Calc"), "x", ctx)).toBeUndefined();
    });

    it("upload mode enforces requiredOnUpload across all given columns", () => {
        const errs = validateAll([col("DocType"), col("Title")], {}, { mode: "upload" });
        expect(errs).toEqual({ DocType: "DocType is required." });
    });

    it("only sends changed fields", () => {
        const edit = {
            row: {},
            original: { Title: "a", Tags: ["x"], Amount: null },
            current: { Title: "a", Tags: ["x", "y"], Amount: null },
            loading: false,
            saving: false,
            errors: {},
        };
        expect(changedValues(edit)).toEqual({ Tags: ["x", "y"] });
        expect(changedValues({ ...edit, current: { ...edit.current, Amount: NaN } })).toHaveProperty("Amount");
    });
});

describe("validateUpdate", () => {
    it("posts only the given form values and surfaces per-field failures", async () => {
        const f = fakeFetch(
            on("POST", "/items(7)/ValidateUpdateListItem()", () => ({
                value: [{ FieldName: "Amount", FieldValue: "x", HasException: true, ErrorMessage: "Bad number", ItemId: 7 }],
            })),
        );
        const items = new ItemService(spFactory(f.fetch)(SITE), { id: "L", title: "c", rootFolderServerRelativeUrl: "/x", enableVersioning: true, forceCheckout: false });
        const out = await items.validateUpdate(7, [{ FieldName: "Amount", FieldValue: "x" }]);
        expect(out.ok).toBe(false);
        expect(out.fieldErrors).toEqual({ Amount: "Bad number" });
        expect(f.calls[0].body).toEqual({ formValues: [{ FieldName: "Amount", FieldValue: "x" }], bNewDocumentUpdate: false });
        expect(f.calls[0].url).toContain("web/lists(guid'L')/items(7)/ValidateUpdateListItem()");
    });
});
