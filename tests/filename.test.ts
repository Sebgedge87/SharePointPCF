import { nextAvailableName, sanitizeFolderSegment, splitExtension, validateFileName, nameExists } from "../src/utils/filename";

describe("validateFileName", () => {
    it.each(['a"b.pdf', "a*b", "a:b", "a<b", "a>b", "a?b", "a/b", "a\\b", "a|b"])("rejects illegal char in %s", (n) => {
        expect(validateFileName(n).valid).toBe(false);
    });
    it.each([".hidden", "file.", "..x", " lead.pdf", "trail.pdf ", "", "CON", "con.txt", "desktop.ini", "~$lock.docx", "a_vti_b.txt", "a..b"])(
        "rejects %j",
        (n) => expect(validateFileName(n).valid).toBe(false),
    );
    it.each(["report.pdf", "Q1 #1 50% (final).docx", "résumé.txt", "a.b.c"])("accepts %j", (n) => expect(validateFileName(n)).toEqual({ valid: true }));

    it("enforces the 400-char path limit including the folder", () => {
        const folder = "/sites/crm/contact/" + "f".repeat(300);
        expect(validateFileName("x".repeat(70) + ".pdf", folder).valid).toBe(true);
        const res = validateFileName("x".repeat(90) + ".pdf", folder);
        expect(res.valid).toBe(false);
        expect(res.error).toMatch(/too long/);
    });
});

describe("collision naming", () => {
    it("prefills name (1).ext and skips taken names case-insensitively", () => {
        expect(nextAvailableName("report.pdf", ["report.pdf"])).toBe("report (1).pdf");
        expect(nextAvailableName("report.pdf", ["REPORT.pdf", "report (1).PDF", "report (2).pdf"])).toBe("report (3).pdf");
        expect(nextAvailableName("report (4).pdf", ["report (4).pdf"])).toBe("report (5).pdf");
        expect(nextAvailableName("README", ["README"])).toBe("README (1)");
        expect(nextAvailableName("archive.tar.gz", [])).toBe("archive.tar (1).gz");
    });
    it("splits extensions and checks existence", () => {
        expect(splitExtension(".env")).toEqual({ stem: ".env", ext: "" });
        expect(nameExists("A.pdf", ["a.PDF"])).toBe(true);
    });
});

describe("sanitizeFolderSegment", () => {
    it("removes illegal and path characters", () => {
        expect(sanitizeFolderSegment(" ..a/b\\c:d*e?#% ")).toBe("a_b_c_d_e___");
        expect(sanitizeFolderSegment("...")).toBe("_");
    });
});
