import { redact } from "../src/services/auth/redact";

describe("redact", () => {
    const jwt = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxMjM0In0.c2lnbmF0dXJl";
    it("removes bearer tokens, JWTs and oauth params", () => {
        const out = redact(`Authorization: Bearer ${jwt} url#access_token=abc&code=xyz {"refresh_token":"r1"}`);
        expect(out).not.toContain(jwt);
        expect(out).not.toContain("abc");
        expect(out).not.toContain("xyz");
        expect(out).not.toContain("r1");
        expect(out).toContain("[REDACTED");
    });
    it("handles errors and objects", () => {
        expect(redact(new Error(`bad ${jwt}`))).toBe("Error: bad [REDACTED_JWT]");
        expect(redact({ accessToken: jwt })).not.toContain(jwt);
    });
});
