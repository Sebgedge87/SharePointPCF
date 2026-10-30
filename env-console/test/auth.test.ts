import { test } from "node:test";
import assert from "node:assert/strict";
import { AuthError, AzureCliTokenProvider, PowerShellTokenProvider, TokenCache, type TokenProvider } from "../src/core/auth.js";
import type { RunResult, Runner } from "../src/core/proc.js";

const ok = (stdout: string): RunResult => ({ code: 0, stdout, stderr: "", notFound: false });
const noInteractive = async () => ({ code: 0, notFound: false });

test("PowerShell provider passes the resource by environment variable and parses the token", async () => {
  let seen: { cmd: string; args: string[]; env?: NodeJS.ProcessEnv } | undefined;
  const run: Runner = async (cmd, args, opts) => {
    seen = { cmd, args, env: opts?.env };
    return ok('WARNING: something\n{"token":"abc","expiresOn":"2030-01-01T00:00:00.0000000Z"}');
  };
  const p = new PowerShellTokenProvider(run, noInteractive, ["pwsh"]);
  const t = await p.getToken("https://org.crm.dynamics.com/", "contoso.onmicrosoft.com");
  assert.equal(t.token, "abc");
  assert.equal(t.expiresOn.toISOString(), "2030-01-01T00:00:00.000Z");
  assert.equal(seen!.cmd, "pwsh");
  assert.ok(seen!.args.includes("-EncodedCommand"));
  assert.equal(seen!.env!.PCX_RESOURCE, "https://org.crm.dynamics.com");
  assert.equal(seen!.env!.PCX_TENANT, "contoso.onmicrosoft.com");
  // The resource never appears in the script text itself.
  assert.ok(!seen!.args.join(" ").includes("org.crm.dynamics.com"));
});

test("PowerShell provider falls back to Windows PowerShell and reports sign-in needed", async () => {
  const tried: string[] = [];
  const run: Runner = async (cmd) => {
    tried.push(cmd);
    if (cmd === "pwsh") return { code: -1, stdout: "", stderr: "", notFound: true };
    return { code: 1, stdout: "", stderr: "Run Connect-AzAccount to login.", notFound: false };
  };
  const p = new PowerShellTokenProvider(run, noInteractive, ["pwsh", "powershell"]);
  await assert.rejects(p.getToken("https://org.crm.dynamics.com"), (e: unknown) => e instanceof AuthError && e.needsLogin);
  assert.deepEqual(tried, ["pwsh", "powershell"]);
});

test("PowerShell provider refuses non-Dataverse resources before running anything", async () => {
  let ran = false;
  const p = new PowerShellTokenProvider(async () => ((ran = true), ok("{}")), noInteractive, ["pwsh"]);
  await assert.rejects(p.getToken("https://graph.example.com"));
  assert.equal(ran, false);
});

test("Azure CLI provider parses expires_on and builds safe arguments", async () => {
  let args: string[] = [];
  const run: Runner = async (_c, a) => ((args = a), ok(JSON.stringify({ accessToken: "xyz", expires_on: 1893456000 })));
  const p = new AzureCliTokenProvider(run, noInteractive, "az");
  const t = await p.getToken("https://org.crm.dynamics.com", "11111111-2222-3333-4444-555555555555");
  assert.equal(t.token, "xyz");
  assert.equal(t.expiresOn.getTime(), 1893456000 * 1000);
  assert.deepEqual(args, ["account", "get-access-token", "--resource", "https://org.crm.dynamics.com", "--output", "json", "--tenant", "11111111-2222-3333-4444-555555555555"]);
  await assert.rejects(p.getToken("https://org.crm.dynamics.com", "bad tenant & calc"), AuthError);
});

test("token cache reuses tokens until five minutes before expiry and shares in-flight requests", async () => {
  let now = 0;
  let calls = 0;
  const provider: TokenProvider = {
    name: "azps",
    login: async () => {},
    logout: async () => {},
    getToken: async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 5));
      return { token: `t${calls}`, expiresOn: new Date(now + 60 * 60_000) };
    }
  };
  const cache = new TokenCache(provider, undefined, () => now);
  const [a, b] = await Promise.all([cache.token("https://org.crm.dynamics.com"), cache.token("https://org.crm.dynamics.com/")]);
  assert.equal(a, "t1");
  assert.equal(b, "t1");
  assert.equal(calls, 1);
  now += 50 * 60_000; // 10 minutes left: still fine
  assert.equal(await cache.token("https://org.crm.dynamics.com"), "t1");
  now += 6 * 60_000; // 4 minutes left: refresh
  assert.equal(await cache.token("https://org.crm.dynamics.com"), "t2");
});

test("sign-in with a code reads the code from PowerShell's output and finishes when it exits", async () => {
  let finish: (code: number) => void = () => {};
  let killed = false;
  let envSeen: NodeJS.ProcessEnv | undefined;
  const capture = (_cmd: string, _args: string[], onOut: (t: string) => void, opts?: { env?: NodeJS.ProcessEnv }) => {
    envSeen = opts?.env;
    setTimeout(() => onOut("WARNING: To sign in, use a web browser to open the page https://microsoft.com/devicelogin and enter the code "), 5);
    setTimeout(() => onOut("ABCD-1234 to authenticate.\n"), 10);
    return { done: new Promise<{ code: number; notFound: boolean }>((r) => (finish = (code) => r({ code, notFound: false }))), kill: () => void (killed = true) };
  };
  const p = new PowerShellTokenProvider(async () => ok("{}"), noInteractive, ["pwsh"], capture);
  const login = await p.startDeviceLogin("contoso.onmicrosoft.com");
  assert.equal(login.code, "ABCD-1234");
  assert.equal(login.url, "https://microsoft.com/devicelogin");
  assert.equal(envSeen!.PCX_DEVICE, "1");
  assert.equal(envSeen!.PCX_TENANT, "contoso.onmicrosoft.com");
  finish(0);
  await login.done;
  login.cancel();
  assert.equal(killed, true);
});

test("sign-in with a code reports a failure when no code appears", async () => {
  const capture = (_c: string, _a: string[], onOut: (t: string) => void) => {
    setTimeout(() => onOut("Connect-AzAccount: AADSTS50059: No tenant-identifying information found\n"), 5);
    return { done: new Promise<{ code: number; notFound: boolean }>((r) => setTimeout(() => r({ code: 1, notFound: false }), 15)), kill: () => {} };
  };
  const p = new PowerShellTokenProvider(async () => ok("{}"), noInteractive, ["pwsh"], capture);
  await assert.rejects(p.startDeviceLogin(), /AADSTS50059/);
});

test("Azure CLI sign-in with a code passes --use-device-code", async () => {
  let args: string[] = [];
  const capture = (_c: string, a: string[], onOut: (t: string) => void) => {
    args = a;
    setTimeout(() => onOut("To sign in, use a web browser to open the page https://microsoft.com/devicelogin and enter the code XYZ98765 to authenticate.\n"), 5);
    return { done: new Promise<{ code: number; notFound: boolean }>((r) => setTimeout(() => r({ code: 0, notFound: false }), 20)), kill: () => {} };
  };
  const p = new AzureCliTokenProvider(async () => ok("{}"), noInteractive, "az", capture);
  const login = await p.startDeviceLogin("11111111-2222-3333-4444-555555555555");
  assert.equal(login.code, "XYZ98765");
  assert.deepEqual(args, ["login", "--allow-no-subscriptions", "--use-device-code", "--tenant", "11111111-2222-3333-4444-555555555555"]);
});
