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

export const ADMIN_USER = { fullname: "Test Admin", domainname: "admin@contoso.com", systemuserroles_association: [{ name: "System Administrator", _roletemplateid_value: "627090ff-40a3-4053-8790-584edc5be201" }] };

/** A fetch stand-in that records calls and answers from a handler. */
export function fakeFetch(handler: Handler) {
  const calls: Call[] = [];
  const fn = async (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => {
    const call = { url, method: init.method, headers: init.headers, body: init.body };
    calls.push(call);
    let r = handler(call);
    // Role checks: unless a test answers them itself, the signed-in user is a System Administrator.
    const roleLookup = url.includes("_roletemplateid_value");
    if (roleLookup && !(r?.body && typeof r.body === "object" && "systemuserroles_association" in (r.body as object))) r = { body: ADMIN_USER };
    if (!r && url.endsWith("/WhoAmI")) r = { body: { UserId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" } };
    r ??= { status: 404, body: { error: { message: "not mocked: " + url } } };
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
