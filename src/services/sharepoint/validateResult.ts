/**
 * validateUpdateListItem returns HTTP 200 even when individual fields fail.
 * Every response must be inspected for HasException / ErrorMessage.
 */
export interface FieldResult {
    FieldName: string;
    FieldValue?: string | null;
    HasException: boolean;
    ErrorCode?: number;
    ErrorMessage?: string | null;
    ItemId?: number;
}

export interface ValidateOutcome {
    ok: boolean;
    itemId?: number;
    /** InternalName -> message, for the specific cell. */
    fieldErrors: Record<string, string>;
    /** Errors not tied to a known field. */
    generalErrors: string[];
}

export function parseValidateResult(response: unknown): ValidateOutcome {
    const body = response as { value?: FieldResult[]; d?: { ValidateUpdateListItem?: { results?: FieldResult[] } } } | FieldResult[] | undefined;
    const rows: FieldResult[] = Array.isArray(body)
        ? body
        : (body?.value ?? body?.d?.ValidateUpdateListItem?.results ?? []);

    const outcome: ValidateOutcome = { ok: true, fieldErrors: {}, generalErrors: [] };
    if (!Array.isArray(rows)) {
        return { ok: false, fieldErrors: {}, generalErrors: ["Unexpected response from SharePoint."] };
    }
    for (const r of rows) {
        if (typeof r.ItemId === "number" && r.ItemId > 0) outcome.itemId = r.ItemId;
        if (r.HasException) {
            outcome.ok = false;
            const msg = r.ErrorMessage?.trim() || `Could not save (error ${r.ErrorCode ?? "unknown"}).`;
            if (r.FieldName) outcome.fieldErrors[r.FieldName] = msg;
            else outcome.generalErrors.push(msg);
        }
    }
    return outcome;
}
