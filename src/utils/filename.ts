/**
 * SharePoint Online file/folder name rules (client-side pre-check; the
 * server remains the authority).
 */
export const ILLEGAL_CHARS = ['"', "*", ":", "<", ">", "?", "/", "\\", "|"];
const ILLEGAL_RE = /["*:<>?/\\|]/;
export const MAX_PATH_LENGTH = 400;
/** Names SharePoint reserves anywhere in a path. */
const RESERVED_NAMES = new Set([".lock", "con", "prn", "aux", "nul", "com0", "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8", "com9", "lpt0", "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9", "desktop.ini", "_vti_"]);

export interface FilenameCheck {
    valid: boolean;
    error?: string;
}

/**
 * @param folderServerRelativeUrl decoded folder path, used for the 400-char total path limit.
 */
export function validateFileName(name: string, folderServerRelativeUrl = ""): FilenameCheck {
    if (!name || !name.trim()) return { valid: false, error: "Enter a file name." };
    if (name !== name.trim()) return { valid: false, error: "The name cannot start or end with a space." };
    if (ILLEGAL_RE.test(name)) {
        return { valid: false, error: `The name cannot contain any of: ${ILLEGAL_CHARS.join(" ")}` };
    }
    // Control characters are not allowed either.
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u001f]/.test(name)) return { valid: false, error: "The name contains invalid characters." };
    if (name.startsWith(".") || name.endsWith(".")) return { valid: false, error: "The name cannot start or end with a period." };
    if (name.includes("..")) return { valid: false, error: "The name cannot contain consecutive periods." };
    const lower = name.toLowerCase();
    const stem = lower.includes(".") ? lower.slice(0, lower.lastIndexOf(".")) : lower;
    if (RESERVED_NAMES.has(lower) || RESERVED_NAMES.has(stem) || lower.startsWith("~$") || lower.includes("_vti_")) {
        return { valid: false, error: "That name is reserved by SharePoint." };
    }
    const fullPath = `${folderServerRelativeUrl.replace(/\/+$/, "")}/${name}`;
    if (fullPath.length > MAX_PATH_LENGTH) {
        return { valid: false, error: `The full path is too long (${fullPath.length} of ${MAX_PATH_LENGTH} characters).` };
    }
    return { valid: true };
}

export function splitExtension(name: string): { stem: string; ext: string } {
    const i = name.lastIndexOf(".");
    if (i <= 0) return { stem: name, ext: "" };
    return { stem: name.slice(0, i), ext: name.slice(i) };
}

/**
 * "report.pdf" -> "report (1).pdf", skipping names already taken
 * (case-insensitive, as SharePoint is). "report (1).pdf" -> "report (2).pdf".
 */
export function nextAvailableName(name: string, taken: Iterable<string>): string {
    const takenLower = new Set(Array.from(taken, (t) => t.toLowerCase()));
    const { stem, ext } = splitExtension(name);
    const m = /^(.*) \((\d+)\)$/.exec(stem);
    const base = m ? m[1] : stem;
    let n = m ? parseInt(m[2], 10) + 1 : 1;
    for (;;) {
        const candidate = `${base} (${n})${ext}`;
        if (!takenLower.has(candidate.toLowerCase())) return candidate;
        n++;
    }
}

export function nameExists(name: string, taken: Iterable<string>): boolean {
    const lower = name.toLowerCase();
    for (const t of taken) if (t.toLowerCase() === lower) return true;
    return false;
}

/** Make a single folder name from arbitrary record data (template tokens). */
export function sanitizeFolderSegment(value: string): string {
    const cleaned = value
        .replace(/["*:<>?/\\|#%]/g, "_")
        // eslint-disable-next-line no-control-regex
        .replace(/[\u0000-\u001f]/g, "")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/^\.+|\.+$/g, "")
        .trim();
    return cleaned || "_";
}
