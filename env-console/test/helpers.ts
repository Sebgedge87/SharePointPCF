import type { EnvConfig } from "../src/core/config.js";
import type { TokenSource } from "../src/core/auth.js";

export const DEV: EnvConfig = { name: "DEV", url: "https://org-dev.crm11.dynamics.com", managed: false };
export const PROD: EnvConfig = { name: "PROD", url: "https://org.crm11.dynamics.com", managed: true };

export const fakeTokens: TokenSource = { token: async () => "test-token" };

export interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

type Handler = (call: Call) => { status?: number; body?: unknown; headers?: Record<string, string> } | undefined;

/** A fetch stand-in that records calls and answers from a handler. */
export function fakeFetch(handler: Handler) {
  const calls: Call[] = [];
  const fn = async (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => {
    const call = { url, method: init.method, headers: init.headers, body: init.body };
    calls.push(call);
    const r = handler(call) ?? { status: 404, body: { error: { message: "not mocked: " + url } } };
    const status = r.status ?? 200;
    const text = r.body === undefined ? "" : JSON.stringify(r.body);
    return {
      status,
      ok: status >= 200 && status < 300,
      headers: { get: (n: string) => r.headers?.[n] ?? null },
      text: async () => text
    };
  };
  return { fn, calls };
}
