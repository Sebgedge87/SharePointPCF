import { backoffDelay, fetchWithRetry, parseRetryAfter } from "../src/utils/retry";
import { HttpClient } from "../src/services/httpClient";
import { scopeForUrl } from "../src/services/auth/scopes";
import { fakeFetch, makeResponse, on } from "./helpers/fakeFetch";

describe("retry", () => {
    it("parses Retry-After seconds and dates", () => {
        expect(parseRetryAfter("5")).toBe(5000);
        expect(parseRetryAfter("Wed, 21 Oct 2015 07:28:10 GMT", Date.parse("Wed, 21 Oct 2015 07:28:00 GMT"))).toBe(10000);
        expect(parseRetryAfter("junk")).toBeUndefined();
        expect(parseRetryAfter(null)).toBeUndefined();
    });

    it("backs off exponentially within bounds", () => {
        expect(backoffDelay(1, { random: () => 0 })).toBe(500);
        expect(backoffDelay(3, { random: () => 1 })).toBe(4000);
        expect(backoffDelay(20, { random: () => 1, maxDelayMs: 30000 })).toBe(30000);
    });

    it("honours Retry-After then succeeds", async () => {
        const sleep = jest.fn(async () => undefined);
        const responses = [makeResponse(429, "", { "Retry-After": "2" }), makeResponse(503), makeResponse(200, "{}")];
        const res = await fetchWithRetry(async () => responses.shift()!, { sleep, random: () => 0 });
        expect(res.status).toBe(200);
        expect(sleep).toHaveBeenNthCalledWith(1, 2000);
        expect(sleep).toHaveBeenCalledTimes(2);
    });

    it("gives up after maxAttempts", async () => {
        const res = await fetchWithRetry(async () => makeResponse(429), { maxAttempts: 3, sleep: async () => undefined });
        expect(res.status).toBe(429);
    });
});

describe("HttpClient", () => {
    const tokenProvider = jest.fn(async (scope: string) => `tok-for-${scope}`);

    it("never requests a token for a disallowed host", async () => {
        const f = fakeFetch();
        const http = new HttpClient({ tokenProvider, scopeFor: scopeForUrl, fetchImpl: f.fetch });
        await expect(http.json("https://evil.com/_api/web")).rejects.toMatchObject({ kind: "host-not-allowed" });
        expect(tokenProvider).not.toHaveBeenCalled();
        expect(f.fetch).not.toHaveBeenCalled();
    });

    it("sends the resource-specific bearer token", async () => {
        const f = fakeFetch(on("GET", "/_api/web", () => ({ Title: "x" })));
        const http = new HttpClient({ tokenProvider, scopeFor: scopeForUrl, fetchImpl: f.fetch });
        await http.json("https://contoso.sharepoint.com/sites/a/_api/web");
        expect(f.calls[0].headers.Authorization).toBe("Bearer tok-for-https://contoso.sharepoint.com/.default");
    });

    it("maps status codes to typed errors without leaking tokens", async () => {
        const f = fakeFetch(
            on("GET", "/403", () => ({ error: { message: { value: "Access denied Bearer abc.def" } } }), 403),
            on("GET", "/404", () => ({}), 404),
            on("GET", "/429", () => ({}), 429),
        );
        const http = new HttpClient({ tokenProvider, scopeFor: scopeForUrl, fetchImpl: f.fetch, retry: { maxAttempts: 1 } });
        const base = "https://contoso.sharepoint.com";
        const e403 = (await http.json(`${base}/403`).catch((e) => e)) as { kind: string; message: string };
        expect(e403.kind).toBe("no-permission");
        expect(e403.message).not.toContain("abc.def");
        await expect(http.json(`${base}/404`)).rejects.toMatchObject({ kind: "not-found" });
        await expect(http.json(`${base}/429`)).rejects.toMatchObject({ kind: "throttled" });
    });
});
