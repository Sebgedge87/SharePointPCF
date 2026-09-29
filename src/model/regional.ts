/**
 * validateUpdateListItem parses numbers and dates as *strings in the web's
 * regional settings*, so values must be formatted for the site, not the user.
 */
export interface RegionalSettings {
    localeId: number;
    /** 0 = MDY, 1 = DMY, 2 = YMD */
    dateFormat: number;
    dateSeparator: string;
    decimalSeparator: string;
    thousandSeparator: string;
    time24: boolean;
    timeSeparator: string;
}

export const DEFAULT_REGIONAL: RegionalSettings = {
    localeId: 1033,
    dateFormat: 0,
    dateSeparator: "/",
    decimalSeparator: ".",
    thousandSeparator: ",",
    time24: false,
    timeSeparator: ":",
};

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Date parts (as the user picked them, interpreted in the site's time zone,
 * which is how SharePoint parses validateUpdateListItem values) -> site string.
 */
export function formatSiteDate(
    parts: { year: number; month: number; day: number; hour?: number; minute?: number },
    r: RegionalSettings,
    includeTime: boolean,
): string {
    const s = r.dateSeparator;
    const d = pad(parts.day);
    const m = pad(parts.month);
    const y = String(parts.year);
    let date: string;
    switch (r.dateFormat) {
        case 1:
            date = `${d}${s}${m}${s}${y}`;
            break;
        case 2:
            date = `${y}${s}${m}${s}${d}`;
            break;
        default:
            date = `${m}${s}${d}${s}${y}`;
    }
    if (!includeTime) return date;
    const h = parts.hour ?? 0;
    const min = pad(parts.minute ?? 0);
    const t = r.timeSeparator;
    if (r.time24) return `${date} ${pad(h)}${t}${min}`;
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${date} ${h12}${t}${min} ${h < 12 ? "AM" : "PM"}`;
}

/** Number -> site string: no grouping, site decimal separator. */
export function formatSiteNumber(value: number, r: RegionalSettings): string {
    const raw = String(value);
    return r.decimalSeparator === "." ? raw : raw.replace(".", r.decimalSeparator);
}
