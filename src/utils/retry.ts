/**
 * Throttling-aware retry. SharePoint and Graph return 429 / 503 with a
 * Retry-After header (seconds, or an HTTP date). Honour it; otherwise use
 * exponential backoff with jitter.
 */
export interface RetryOptions {
    maxAttempts?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
    sleep?: (ms: number) => Promise<void>;
    now?: () => number;
    random?: () => number;
}

export const RETRYABLE_STATUS = new Set([429, 503, 504]);

export function parseRetryAfter(value: string | null | undefined, now: number = Date.now()): number | undefined {
    if (!value) return undefined;
    const trimmed = value.trim();
    if (/^\d+(\.\d+)?$/.test(trimmed)) return Math.round(parseFloat(trimmed) * 1000);
    const date = Date.parse(trimmed);
    if (!isNaN(date)) return Math.max(0, date - now);
    return undefined;
}

export function backoffDelay(attempt: number, opts: RetryOptions = {}): number {
    const base = opts.baseDelayMs ?? 1000;
    const max = opts.maxDelayMs ?? 30000;
    const random = opts.random ?? Math.random;
    const exp = Math.min(max, base * Math.pow(2, attempt - 1));
    return Math.round(exp / 2 + random() * (exp / 2));
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Call `doFetch` until it returns a non-retryable response or attempts run out.
 * The last response is returned (callers turn a final 429 into a "throttled" error).
 */
export async function fetchWithRetry(doFetch: () => Promise<Response>, opts: RetryOptions = {}): Promise<Response> {
    const maxAttempts = opts.maxAttempts ?? 5;
    const sleep = opts.sleep ?? defaultSleep;
    const maxDelay = opts.maxDelayMs ?? 30000;
    let attempt = 0;
    for (;;) {
        attempt++;
        const res = await doFetch();
        if (!RETRYABLE_STATUS.has(res.status) || attempt >= maxAttempts) return res;
        const retryAfter = parseRetryAfter(res.headers.get("Retry-After"), opts.now?.());
        const delay = Math.min(maxDelay * 4, retryAfter ?? backoffDelay(attempt, opts));
        await sleep(delay);
    }
}
