import { applyEditorOverride, resolveEditor } from "../src/model/editorRegistry";
import { buildColumns, uploadColumnsFor } from "../src/model/columns";
import { field } from "./helpers/fields";

describe("resolveEditor", () => {
    it.each([
        ["Text", {}, "text"],
        ["Note", {}, "textarea"],
        ["Note", { RichText: true }, "readonly"],
        ["Note", { AppendOnly: true }, "readonly"],
        ["Choice", {}, "choice"],
        ["MultiChoice", {}, "multichoice"],
        ["Number", {}, "number"],
        ["Currency", {}, "number"],
        ["DateTime", { DisplayFormat: 0 }, "date"],
        ["DateTime", { DisplayFormat: 1 }, "datetime"],
        ["Boolean", {}, "boolean"],
        ["Lookup", {}, "lookup"],
        ["Lookup", { AllowMultipleValues: true }, "lookupMulti"],
        ["LookupMulti", {}, "lookupMulti"],
        ["User", {}, "user"],
        ["UserMulti", {}, "userMulti"],
        ["TaxonomyFieldType", {}, "taxonomy"],
        ["TaxonomyFieldTypeMulti", {}, "taxonomyMulti"],
        ["URL", {}, "url"],
        ["Calculated", {}, "readonly"],
        ["Computed", {}, "readonly"],
        ["SomethingNew", {}, "readonly"],
        ["", {}, "readonly"],
    ])("%s %j -> %s", (type, extra, editor) => {
        expect(resolveEditor(field("F", type, extra)).editor).toBe(editor);
    });

    it("keeps system and read-only columns read-only", () => {
        expect(resolveEditor(field("Modified", "DateTime")).editor).toBe("readonly");
        expect(resolveEditor(field("Author", "User")).editor).toBe("readonly");
        expect(resolveEditor(field("X", "Text", { ReadOnlyField: true })).editor).toBe("readonly");
        expect(resolveEditor(field("FileLeafRef", "File")).editor).toBe("filename");
    });

    it("explains unknown types", () => {
        expect(resolveEditor(field("F", "Weird")).reason).toBe("unsupported type Weird");
    });

    it("only allows stricter/equivalent editor overrides", () => {
        expect(applyEditorOverride("text", "readonly")).toBe("readonly");
        expect(applyEditorOverride("text", "textarea")).toBe("textarea");
        expect(applyEditorOverride("readonly", "text")).toBeUndefined();
        expect(applyEditorOverride("choice", "text")).toBeUndefined();
        expect(applyEditorOverride("number", undefined)).toBe("number");
    });
});

describe("buildColumns", () => {
    const fields = [
        field("FileLeafRef", "File", { Title: "Name" }),
        field("Title", "Text"),
        field("DocType", "Choice", { Required: true, Choices: ["A", "B"] }),
        field("Calc", "Calculated"),
        field("Odd", "Geolocation2"),
        field("Secret", "Text"),
    ];

    it("follows view order, maps aliases, applies overrides, skips unknown view fields", () => {
        const r = buildColumns(["DocIcon", "LinkFilename", "DocType", "Calc", "Odd", "Missing", "Secret", "Title"], fields, {
            Secret: { hidden: true },
            Title: { label: "Subject", readOnly: true },
        });
        expect(r.columns.map((c) => c.key)).toEqual(["FileLeafRef", "DocType", "Calc", "Odd", "Title"]);
        const title = r.columns.find((c) => c.key === "Title")!;
        expect(title).toMatchObject({ label: "Subject", editable: false, editor: "readonly" });
        expect(r.columns.find((c) => c.key === "Odd")).toMatchObject({ editable: false, readOnlyReason: "unsupported type Geolocation2" });
        expect(r.warnings).toEqual(['View column "Missing" was not found in the list schema; skipped.']);
    });

    it("is stricter, never looser", () => {
        const r = buildColumns(["DocType", "Calc", "Title"], fields, {
            DocType: { requiredOnUpload: false },
            Calc: { readOnly: false },
            Title: { requiredOnUpload: true, editor: "choice" },
        });
        const [docType, calc, title] = r.columns;
        expect(docType.requiredOnUpload).toBe(true);
        expect(calc.editable).toBe(false);
        expect(title.requiredOnUpload).toBe(true);
        expect(title.editor).toBe("text");
        expect(r.warnings).toHaveLength(3);
    });

    it("upload columns come from the content type, not the view", () => {
        const ct = { id: "0x0101", name: "Document", fieldLinks: { Title: { required: true, hidden: false }, DocType: { required: false, hidden: false } } };
        // DocType is Required at list level; Title is required by the content type; Secret forced by config.
        const cols = uploadColumnsFor(ct, fields, { Secret: { requiredOnUpload: true } });
        expect(cols.map((c) => c.key).sort()).toEqual(["DocType", "Secret", "Title"]);
    });
});
