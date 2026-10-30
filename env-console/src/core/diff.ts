export type DiffLine = { t: "ctx" | "add" | "del" | "skip"; text: string };

const MAX_LINES = 4000;

/** Pretty-prints XML so a line diff is readable (one element per line, indented). */
export function prettyXml(xml: string): string {
  const parts = xml.replace(/\r?\n/g, " ").replace(/>\s*</g, ">\n<").split("\n");
  let depth = 0;
  return parts
    .map((p) => {
      const line = p.trim();
      if (/^<\/[^>]+>$/.test(line)) depth = Math.max(0, depth - 1);
      const out = "  ".repeat(depth) + line;
      if (/^<[^!?/][^>]*[^/]>$/.test(line) && !/^<[^>]+>.*<\/[^>]+>$/.test(line)) depth++;
      return out;
    })
    .join("\n");
}

/** Pretty-prints JSON text; returns the input unchanged if it is not JSON. */
export function prettyJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

/** Line diff (LCS) with `context` unchanged lines kept around each change. */
export function diffLines(a: string, b: string, context = 3): { lines: DiffLine[]; changed: boolean; tooLarge?: boolean } {
  const A = a.split("\n");
  const B = b.split("\n");
  if (a === b) return { lines: [], changed: false };
  if (A.length > MAX_LINES || B.length > MAX_LINES) return { lines: [], changed: true, tooLarge: true };
  const n = A.length;
  const m = B.length;
  const w = m + 1;
  const dp = new Uint32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * w + j] = A[i] === B[j] ? dp[(i + 1) * w + j + 1]! + 1 : Math.max(dp[(i + 1) * w + j]!, dp[i * w + j + 1]!);
    }
  }
  const all: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) {
      all.push({ t: "ctx", text: A[i]! });
      i++;
      j++;
    } else if (dp[(i + 1) * w + j]! >= dp[i * w + j + 1]!) all.push({ t: "del", text: A[i++]! });
    else all.push({ t: "add", text: B[j++]! });
  }
  while (i < n) all.push({ t: "del", text: A[i++]! });
  while (j < m) all.push({ t: "add", text: B[j++]! });

  // Keep only context near changes.
  const keep = new Array<boolean>(all.length).fill(false);
  all.forEach((l, k) => {
    if (l.t !== "ctx") for (let x = Math.max(0, k - context); x <= Math.min(all.length - 1, k + context); x++) keep[x] = true;
  });
  const lines: DiffLine[] = [];
  let skipped = 0;
  all.forEach((l, k) => {
    if (keep[k]) {
      if (skipped) lines.push({ t: "skip", text: `… ${skipped} unchanged lines …` });
      skipped = 0;
      lines.push(l);
    } else skipped++;
  });
  if (skipped) lines.push({ t: "skip", text: `… ${skipped} unchanged lines …` });
  return { lines, changed: true };
}
