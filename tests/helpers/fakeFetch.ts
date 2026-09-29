export interface Recorded {
    url: string;
    method: string;
    headers: Record<string, string>;
    body: unknown;
}

type Handler = (req: Recorded) => { status?: number; body?: unknown; headers?: Record<string, string> } | undefined;

/** Minimal Response stand-in (jest node env). */
export function makeResponse(status: number, body?: unknown, headers: Record<string, string> = {}): Response {
    const text = body === undefined ? "" : typeof body === "string" ? body : JSON.stringify(body);
    const h = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
    return {
        status,
        ok: status >= 200 && status < 300,
        statusText: String(status),
        headers: { get: (k: string) => h.get(k.toLowerCase()) ?? null },
        text: async () => text,
        json: async () => JSON.parse(text),
    } as unknown as Response;
}

/** Routes requests to handlers in order; records every call. Unmatched -> 500. */
export function fakeFetch(...handlers: Handler[]) {
    const calls: Recorded[] = [];
    const fn = jest.fn(async (url: string, init?: RequestInit) => {
        const req: Recorded = {
            url: decodeURIComponent(url),
            method: init?.method ?? "GET",
            headers: (init?.headers as Record<string, string>) ?? {},
            body: typeof init?.body === "string" ? JSON.parse(init.body) : init?.body,
        };
        calls.push(req);
        for (const h of handlers) {
            const r = h(req);
            if (r) return makeResponse(r.status ?? 200, r.body, r.headers);
        }
        return makeResponse(500, { error: { message: `unhandled ${req.method} ${req.url}` } });
    });
    return { fetch: fn, calls };
}

export const on =
    (method: string, pattern: RegExp | string, respond: (req: Recorded) => unknown, status = 200): Handler =>
    (req) => {
        const match = typeof pattern === "string" ? req.url.includes(pattern) : pattern.test(req.url);
        if (req.method === method && match) return { status, body: respond(req) };
        return undefined;
    };
