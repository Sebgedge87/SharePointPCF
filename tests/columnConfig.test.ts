import { parseColumnConfig } from "../src/config/columnConfig";

describe("parseColumnConfig", () => {
    it("returns empty config for empty input", () => {
        expect(parseColumnConfig(undefined)).toEqual({ config: {}, warnings: [] });
        expect(parseColumnConfig("  ")).toEqual({ config: {}, warnings: [] });
    });

    it("parses known options", () => {
        const r = parseColumnConfig(
            JSON.stringify({ DocType: { requiredOnUpload: true, label: " Type ", default: "Contract", editor: "choice" }, Legacy: { hidden: true } }),
        );
        expect(r.warnings).toEqual([]);
        expect(r.config).toEqual({
            DocType: { requiredOnUpload: true, label: "Type", default: "Contract", editor: "choice" },
            Legacy: { hidden: true },
        });
    });

    it("ignores invalid JSON and bad shapes with warnings instead of throwing", () => {
        expect(parseColumnConfig("{nope").warnings[0]).toMatch(/not valid JSON/);
        expect(parseColumnConfig("[1,2]").warnings[0]).toMatch(/must be a JSON object/);
        const r = parseColumnConfig(JSON.stringify({ A: 5, B: { readOnly: "yes", colour: "red", label: "" } }));
        expect(r.config).toEqual({ B: {} });
        expect(r.warnings).toHaveLength(4);
    });
});
