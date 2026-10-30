/** Runs `fn` over `items` with at most `limit` in flight; keeps input order. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!, i);
    }
  });
  await Promise.all(workers);
  return out;
}

/** Parses "24h", "7d", "30m" into a start date; defaults to 24 hours ago. */
export function sinceDate(spec: string | undefined, now = Date.now()): Date {
  const m = /^(\d{1,4})\s*([mhd])$/i.exec((spec ?? "24h").trim());
  if (!m) throw new Error(`Time range must look like 30m, 24h or 7d (got "${spec}")`);
  const n = Number(m[1]);
  const unit = m[2]!.toLowerCase() === "m" ? 60_000 : m[2]!.toLowerCase() === "h" ? 3_600_000 : 86_400_000;
  return new Date(now - n * unit);
}

/** Formatted value annotation helper for Dataverse rows. */
export function fv(row: Record<string, unknown>, field: string): string | undefined {
  const v = row[`${field}@OData.Community.Display.V1.FormattedValue`];
  return typeof v === "string" ? v : undefined;
}

/** A metadata label's text in the user's language. */
export function label(l: unknown): string {
  const x = l as { UserLocalizedLabel?: { Label?: string } | null; LocalizedLabels?: { Label?: string }[] } | null | undefined;
  return x?.UserLocalizedLabel?.Label ?? x?.LocalizedLabels?.[0]?.Label ?? "";
}
