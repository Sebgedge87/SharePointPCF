import { execFile, spawn } from "node:child_process";

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
  /** The executable was not found on PATH. */
  notFound: boolean;
}

export interface RunOptions {
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}

/** Runs a command without a shell and captures its output. Swappable in tests. */
export type Runner = (cmd: string, args: string[], opts?: RunOptions) => Promise<RunResult>;

/** Runs a command attached to this terminal (for interactive sign-in). Resolves with its exit code. */
export type InteractiveRunner = (cmd: string, args: string[], opts?: RunOptions) => Promise<{ code: number; notFound: boolean }>;

// Windows .cmd shims (az.cmd) cannot be started without a shell. Callers validate every
// argument they pass to such commands against strict patterns first.
function needsShell(cmd: string): boolean {
  return process.platform === "win32" && /\.(cmd|bat)$/i.test(cmd);
}

export const runProcess: Runner = (cmd, args, opts = {}) =>
  new Promise((resolveRun) => {
    execFile(
      cmd,
      args,
      { env: opts.env ?? process.env, timeout: opts.timeoutMs ?? 90_000, maxBuffer: 16 * 1024 * 1024, windowsHide: true, shell: needsShell(cmd) },
      (err, stdout, stderr) => {
        const e = err as (NodeJS.ErrnoException & { code?: number | string }) | null;
        const notFound = !!e && e.code === "ENOENT";
        const code = !e ? 0 : typeof e.code === "number" ? e.code : -1;
        resolveRun({ code, stdout: String(stdout ?? ""), stderr: String(stderr ?? "") + (e && code === -1 ? `\n${e.message}` : ""), notFound });
      }
    );
  });

export const runInteractive: InteractiveRunner = (cmd, args, opts = {}) =>
  new Promise((resolveRun) => {
    const child = spawn(cmd, args, { env: opts.env ?? process.env, stdio: "inherit", shell: needsShell(cmd) });
    child.on("error", (err: NodeJS.ErrnoException) => resolveRun({ code: -1, notFound: err.code === "ENOENT" }));
    child.on("exit", (code) => resolveRun({ code: code ?? -1, notFound: false }));
  });
