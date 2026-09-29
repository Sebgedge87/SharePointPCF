/**
 * columnConfig: JSON overrides keyed by field InternalName.
 *
 *   {
 *     "DocType": { "requiredOnUpload": true, "label": "Type", "default": "Contract" },
 *     "Notes":   { "readOnly": true },
 *     "Legacy":  { "hidden": true },
 *     "Ref":     { "editor": "readonly" }
 *   }
 *
 * Overrides can be stricter than SharePoint, never looser: readOnly:false
 * cannot unlock a read-only field and requiredOnUpload:false cannot relax a
 * required one. Merging with the schema happens in model/columns.ts.
 */
export interface ColumnOverride {
    requiredOnUpload?: boolean;
    readOnly?: boolean;
    hidden?: boolean;
    editor?: string;
    label?: string;
    default?: unknown;
}

export type ColumnConfig = Record<string, ColumnOverride>;

export interface ParsedColumnConfig {
    config: ColumnConfig;
    warnings: string[];
}

const KNOWN_KEYS = new Set(["requiredOnUpload", "readOnly", "hidden", "editor", "label", "default"]);

export function parseColumnConfig(json: string | undefined | null): ParsedColumnConfig {
    const warnings: string[] = [];
    const config: ColumnConfig = {};
    if (!json || !json.trim()) return { config, warnings };

    let parsed: unknown;
    try {
        parsed = JSON.parse(json);
    } catch (e) {
        warnings.push(`columnConfig is not valid JSON and was ignored (${(e as Error).message}).`);
        return { config, warnings };
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        warnings.push("columnConfig must be a JSON object keyed by column internal name; it was ignored.");
        return { config, warnings };
    }

    for (const [field, value] of Object.entries(parsed as Record<string, unknown>)) {
        if (!value || typeof value !== "object" || Array.isArray(value)) {
            warnings.push(`columnConfig.${field} must be an object; ignored.`);
            continue;
        }
        const out: ColumnOverride = {};
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
            if (!KNOWN_KEYS.has(k)) {
                warnings.push(`columnConfig.${field}.${k} is not a known option; ignored.`);
                continue;
            }
            switch (k) {
                case "requiredOnUpload":
                case "readOnly":
                case "hidden":
                    if (typeof v === "boolean") out[k] = v;
                    else warnings.push(`columnConfig.${field}.${k} must be true or false; ignored.`);
                    break;
                case "editor":
                case "label":
                    if (typeof v === "string" && v.trim()) out[k] = v.trim();
                    else warnings.push(`columnConfig.${field}.${k} must be a non-empty string; ignored.`);
                    break;
                case "default":
                    out.default = v;
                    break;
            }
        }
        config[field] = out;
    }
    return { config, warnings };
}
