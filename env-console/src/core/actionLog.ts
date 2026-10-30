import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface ActionEntry {
  at: string;
  env: string;
  action: string;
  kind: string;
  id: string;
  name: string;
  reason?: string;
  actor?: string;
  source: "cli" | "dashboard";
  ok: boolean;
  error?: string;
}

export function actionLogPath(): string {
  return process.env.PCX_ACTION_LOG ?? join(homedir(), ".pcx", "actions.log");
}

/** Local record of every change made through pcx (Dataverse auditing records it server-side too). */
export function appendAction(entry: ActionEntry, path = actionLogPath()): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  appendFileSync(path, JSON.stringify(entry) + "\n", { mode: 0o600 });
}

export function readActions(limit = 100, path = actionLogPath()): ActionEntry[] {
  if (!existsSync(path)) return [];
  const lines = readFileSync(path, "utf8").split("\n").filter(Boolean);
  const out: ActionEntry[] = [];
  for (const l of lines.slice(-limit)) {
    try {
      out.push(JSON.parse(l) as ActionEntry);
    } catch {
      /* skip damaged line */
    }
  }
  return out.reverse();
}
