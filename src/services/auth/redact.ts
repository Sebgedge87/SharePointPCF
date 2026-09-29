/**
 * Strip anything that looks like a credential from text before it is logged
 * or shown. Defensive: callers should not be passing tokens here anyway.
 */
const PATTERNS: [RegExp, string][] = [
    // Authorization headers
    [/(bearer\s+)[A-Za-z0-9\-_.~+/=]+/gi, "$1[REDACTED]"],
    // JWTs (header.payload.signature, header starts with eyJ)
    [/eyJ[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]*/g, "[REDACTED_JWT]"],
    // OAuth params in URLs, fragments or JSON
    [
        /((?:access_token|id_token|refresh_token|code|client_info|session_state|code_verifier)["']?\s*[=:]\s*["']?)[^"'&\s,}]+/gi,
        "$1[REDACTED]",
    ],
];

export function redact(input: unknown): string {
    let text: string;
    if (input instanceof Error) {
        text = `${input.name}: ${input.message}`;
    } else if (typeof input === "string") {
        text = input;
    } else {
        try {
            text = JSON.stringify(input);
        } catch {
            text = String(input);
        }
    }
    for (const [re, replacement] of PATTERNS) {
        text = text.replace(re, replacement);
    }
    return text;
}

/** Console logging that always redacts. Use this instead of console.* in services. */
export const log = {
    warn(message: string, detail?: unknown): void {
        console.warn(`[SPMetadataGrid] ${redact(message)}`, detail === undefined ? "" : redact(detail));
    },
    error(message: string, detail?: unknown): void {
        console.error(`[SPMetadataGrid] ${redact(message)}`, detail === undefined ? "" : redact(detail));
    },
};
