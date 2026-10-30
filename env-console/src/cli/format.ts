const useColor = process.stdout.isTTY && !process.env.NO_COLOR;

const wrap = (code: string) => (s: string) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
export const c = {
  green: wrap("32"),
  red: wrap("31"),
  yellow: wrap("33"),
  blue: wrap("34"),
  dim: wrap("2"),
  bold: wrap("1")
};

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;]*m/g;
const visible = (s: string) => s.replace(ANSI, "").length;

/** Prints rows as an aligned plain-text table. */
export function table(headers: string[], rows: string[][]): string {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => visible(r[i] ?? ""))));
  const line = (cells: string[]) => cells.map((cell, i) => cell + " ".repeat(Math.max(0, widths[i]! - visible(cell)))).join("  ").trimEnd();
  return [c.dim(line(headers)), ...rows.map(line)].join("\n");
}
