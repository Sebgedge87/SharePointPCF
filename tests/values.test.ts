import { serializeValue, serializeTerms, serializePeople, serializeUrl, isEmptyValue, personKeyFromUpn } from "../src/model/values";
import { DEFAULT_REGIONAL, formatSiteDate } from "../src/model/regional";
import { parseValidateResult } from "../src/services/sharepoint/validateResult";

const uk = { ...DEFAULT_REGIONAL, dateFormat: 1, time24: true, decimalSeparator: ",", localeId: 2057 };

describe("serializeValue", () => {
    it("text, choice, multichoice, boolean", () => {
        expect(serializeValue("text", "hello", DEFAULT_REGIONAL)).toBe("hello");
        expect(serializeValue("text", null, DEFAULT_REGIONAL)).toBe("");
        expect(serializeValue("multichoice", ["A", "B"], DEFAULT_REGIONAL)).toBe("A;#B");
        expect(serializeValue("boolean", true, DEFAULT_REGIONAL)).toBe("1");
        expect(serializeValue("boolean", false, DEFAULT_REGIONAL)).toBe("0");
    });

    it("numbers and dates use the site's regional settings", () => {
        expect(serializeValue("number", 1234.5, DEFAULT_REGIONAL)).toBe("1234.5");
        expect(serializeValue("number", 1234.5, uk)).toBe("1234,5");
        expect(serializeValue("number", null, uk)).toBe("");
        expect(serializeValue("date", "2026-09-03", DEFAULT_REGIONAL)).toBe("09/03/2026");
        expect(serializeValue("date", "2026-09-03", uk)).toBe("03/09/2026");
        expect(serializeValue("datetime", "2026-09-03T14:05", DEFAULT_REGIONAL)).toBe("09/03/2026 2:05 PM");
        expect(serializeValue("datetime", "2026-09-03T00:30", DEFAULT_REGIONAL)).toBe("09/03/2026 12:30 AM");
        expect(serializeValue("datetime", "2026-09-03T14:05", uk)).toBe("03/09/2026 14:05");
        expect(formatSiteDate({ year: 2026, month: 1, day: 2 }, { ...DEFAULT_REGIONAL, dateFormat: 2, dateSeparator: "-" }, false)).toBe("2026-01-02");
    });

    it("lookups", () => {
        expect(serializeValue("lookup", { id: 7, title: "x" }, DEFAULT_REGIONAL)).toBe("7");
        expect(serializeValue("lookupMulti", [{ id: 1, title: "a" }, { id: 2, title: "b" }], DEFAULT_REGIONAL)).toBe("1;#;#2;#");
        expect(serializeValue("lookupMulti", [], DEFAULT_REGIONAL)).toBe("");
    });

    it("people as claims JSON", () => {
        const p = { key: personKeyFromUpn("jane@contoso.com"), displayText: "Jane" };
        expect(p.key).toBe("i:0#.f|membership|jane@contoso.com");
        expect(serializeValue("user", p, DEFAULT_REGIONAL)).toBe('[{"Key":"i:0#.f|membership|jane@contoso.com"}]');
        expect(serializePeople([p, { key: "i:0#.f|membership|bob@contoso.com", displayText: "Bob" }])).toBe(
            '[{"Key":"i:0#.f|membership|jane@contoso.com"},{"Key":"i:0#.f|membership|bob@contoso.com"}]',
        );
        expect(serializeValue("userMulti", [], DEFAULT_REGIONAL)).toBe("");
        expect(personKeyFromUpn("i:0#.f|membership|x@y.z")).toBe("i:0#.f|membership|x@y.z");
    });

    it("taxonomy as Label|guid;Label|guid", () => {
        const a = { label: "Finance", termId: "11111111-1111-1111-1111-111111111111" };
        const b = { label: "HR; Ops|x", termId: "22222222-2222-2222-2222-222222222222" };
        expect(serializeValue("taxonomy", a, DEFAULT_REGIONAL)).toBe("Finance|11111111-1111-1111-1111-111111111111");
        expect(serializeTerms([a, b])).toBe("Finance|11111111-1111-1111-1111-111111111111;HR  Ops x|22222222-2222-2222-2222-222222222222");
    });

    it("urls escape commas", () => {
        expect(serializeUrl({ url: "https://x.com/a,b", description: "Site" })).toBe("https://x.com/a,,b, Site");
        expect(serializeUrl({ url: " ", description: "x" })).toBe("");
    });

    it("never serialises read-only", () => {
        expect(() => serializeValue("readonly", "x", DEFAULT_REGIONAL)).toThrow();
    });

    it("empty checks", () => {
        expect(isEmptyValue("text", "  ")).toBe(true);
        expect(isEmptyValue("boolean", false)).toBe(false);
        expect(isEmptyValue("url", { url: "", description: "d" })).toBe(true);
        expect(isEmptyValue("userMulti", [])).toBe(true);
    });
});

describe("parseValidateResult", () => {
    it("treats HTTP 200 with HasException as failure, per field", () => {
        const r = parseValidateResult({
            value: [
                { FieldName: "Title", FieldValue: "x", HasException: false, ErrorCode: 0, ErrorMessage: null, ItemId: 12 },
                { FieldName: "Amount", FieldValue: "abc", HasException: true, ErrorCode: -2130575193, ErrorMessage: "Invalid number value." },
                { FieldName: "", HasException: true, ErrorCode: 1, ErrorMessage: "" },
            ],
        });
        expect(r.ok).toBe(false);
        expect(r.itemId).toBe(12);
        expect(r.fieldErrors).toEqual({ Amount: "Invalid number value." });
        expect(r.generalErrors).toEqual(["Could not save (error 1)."]);
    });

    it("accepts verbose and bare-array shapes", () => {
        expect(parseValidateResult({ d: { ValidateUpdateListItem: { results: [{ FieldName: "A", HasException: false }] } } }).ok).toBe(true);
        expect(parseValidateResult([{ FieldName: "A", HasException: true, ErrorMessage: "bad" }]).fieldErrors).toEqual({ A: "bad" });
        expect(parseValidateResult({}).ok).toBe(true);
    });
});
