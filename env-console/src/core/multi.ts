import type { EnvConfig } from "./config.js";
import type { DataverseClient } from "./dataverse.js";
import type { Workspace } from "./environments.js";

export interface PerEnv<T> {
  environments: string[];
  /** Results keyed by environment name; an environment that failed is missing here and present in `errors`. */
  results: Record<string, T>;
  errors: Record<string, string>;
}

/** Runs `fn` against every environment at once and collects results and errors per environment. */
export async function acrossEnvs<T>(ws: Workspace, envs: EnvConfig[], fn: (client: DataverseClient, env: EnvConfig) => Promise<T>): Promise<PerEnv<T>> {
  const results: Record<string, T> = {};
  const errors: Record<string, string> = {};
  await Promise.all(
    envs.map(async (e) => {
      try {
        results[e.name] = await fn(ws.client(e), e);
      } catch (err) {
        errors[e.name] = (err as Error).message;
      }
    })
  );
  return { environments: envs.map((e) => e.name), results, errors };
}

/**
 * Lines up items from several environments into rows, one cell per environment.
 * `key` decides which items are "the same thing" (an ID that solutions keep stable, or a name).
 */
export function matrix<T, R>(
  per: Record<string, T[]>,
  envNames: string[],
  key: (item: T) => string,
  row: (first: T) => R
): (R & { key: string; cells: Record<string, T | null> })[] {
  const rows = new Map<string, R & { key: string; cells: Record<string, T | null> }>();
  for (const env of envNames) {
    for (const item of per[env] ?? []) {
      const k = key(item);
      let r = rows.get(k);
      if (!r) {
        r = { ...row(item), key: k, cells: {} };
        rows.set(k, r);
      }
      r.cells[env] = item;
    }
  }
  for (const r of rows.values()) for (const env of envNames) if (per[env] && !(env in r.cells)) r.cells[env] = null;
  return [...rows.values()];
}
