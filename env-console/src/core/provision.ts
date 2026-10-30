import type { TokenSource } from "./auth.js";
import { normaliseEnvUrl } from "./config.js";

/**
 * Creates Power Platform environments (with a Dataverse database) through the Power Platform
 * admin API, the same API the Power Platform admin centre and Microsoft's admin tools use.
 */

export const BAP_HOST = "https://api.bap.microsoft.com";
/** Token audience for the Power Platform admin API. */
export const BAP_RESOURCE = "https://service.powerapps.com/";
export const BAP_API_VERSION = "2021-04-01";

export const ENV_TYPES = ["Sandbox", "Production", "Developer", "Trial"] as const;
export type EnvType = (typeof ENV_TYPES)[number];

/** Power Platform regions (the "location" of an environment). */
export const REGIONS: Record<string, string> = {
  unitedkingdom: "United Kingdom",
  europe: "Europe",
  unitedstates: "United States",
  canada: "Canada",
  southamerica: "South America",
  australia: "Australia",
  asia: "Asia",
  japan: "Japan",
  india: "India",
  korea: "Korea",
  singapore: "Singapore",
  france: "France",
  germany: "Germany",
  switzerland: "Switzerland",
  norway: "Norway",
  sweden: "Sweden",
  unitedarabemirates: "United Arab Emirates",
  southafrica: "South Africa"
};

export interface NewEnvironment {
  displayName: string;
  type: EnvType;
  region: string;
  /** The first part of the URL: <domain>.crm11.dynamics.com. Generated when empty. */
  domain?: string;
  /** ISO currency code, e.g. GBP. */
  currency: string;
  /** Base language LCID, e.g. 1033 (English). */
  language: number;
  /** Only members of this Entra security group get access. Optional. */
  securityGroupId?: string;
  description?: string;
}

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Checks and tidies a request; throws with a plain message on bad input. */
export function validateNewEnvironment(input: Partial<NewEnvironment>): NewEnvironment {
  const displayName = String(input.displayName ?? "").trim();
  // eslint-disable-next-line no-control-regex
  if (!displayName || displayName.length > 100 || /[\u0000-\u001f]/.test(displayName)) throw new Error("Give the environment a name (up to 100 characters).");
  const type = ENV_TYPES.find((t) => t.toLowerCase() === String(input.type ?? "Sandbox").toLowerCase());
  if (!type) throw new Error(`Type must be one of: ${ENV_TYPES.join(", ")}`);
  const region = String(input.region ?? "").toLowerCase().replace(/[\s-]/g, "");
  if (!REGIONS[region]) throw new Error(`Region must be one of: ${Object.keys(REGIONS).join(", ")}`);
  const domain = String(input.domain ?? "").trim().toLowerCase();
  if (domain && !/^[a-z][a-z0-9-]{0,61}[a-z0-9]$/.test(domain)) throw new Error("The URL name can use letters, digits and hyphens, must start with a letter, and be 2-63 characters.");
  const currency = String(input.currency ?? "GBP").trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error("Currency must be a 3-letter code such as GBP, EUR or USD.");
  const language = Number(input.language ?? 1033);
  if (!Number.isInteger(language) || language < 1025 || language > 99999) throw new Error("Language must be a language code such as 1033 (English).");
  const securityGroupId = String(input.securityGroupId ?? "").trim();
  if (securityGroupId && !GUID.test(securityGroupId)) throw new Error("The security group must be its object ID (a GUID).");
  const description = String(input.description ?? "").trim().slice(0, 500);
  const out: NewEnvironment = { displayName, type, region, currency, language };
  if (domain) out.domain = domain;
  if (securityGroupId) out.securityGroupId = securityGroupId;
  if (description) out.description = description;
  return out;
}

/** The request body for the admin API. */
export function createBody(e: NewEnvironment): Record<string, unknown> {
  const meta: Record<string, unknown> = { baseLanguage: e.language, currency: { code: e.currency }, templates: [] };
  if (e.domain) meta.domainName = e.domain;
  if (e.securityGroupId) meta.securityGroupId = e.securityGroupId;
  return {
    location: e.region,
    properties: {
      displayName: e.displayName,
      ...(e.description ? { description: e.description } : {}),
      environmentSku: e.type,
      databaseType: "CommonDataService",
      linkedEnvironmentMetadata: meta
    }
  };
}

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<{ status: number; ok: boolean; headers: { get(n: string): string | null }; text(): Promise<string> }>;

export interface CreateOptions {
  fetchImpl?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  /** Give up waiting after this long (the environment may still finish). Default 30 minutes. */
  timeoutMs?: number;
  /** Return as soon as the request is accepted. */
  noWait?: boolean;
  onProgress?: (message: string) => void;
  now?: () => number;
}

export interface CreatedEnvironment {
  id?: string;
  displayName: string;
  /** Dataverse URL, once known. */
  url?: string;
  state: "Succeeded" | "Accepted" | "Running";
}

export class ProvisionError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message);
  }
}

/** Only ever follow links back to the admin API, so the token can't be sent anywhere else. */
function safeBapUrl(raw: string): string {
  const u = new URL(raw, BAP_HOST);
  if (u.origin !== BAP_HOST) throw new ProvisionError(`Refusing to follow a link to ${u.origin}`);
  return u.toString();
}

function explain(status: number, text: string): string {
  let msg = "";
  let code = "";
  try {
    const j = JSON.parse(text) as { error?: { code?: string; message?: string } };
    msg = j.error?.message ?? "";
    code = j.error?.code ?? "";
  } catch {
    msg = text.slice(0, 300);
  }
  if (status === 401) return "Sign-in for the Power Platform admin API failed. Sign in again and retry.";
  if (status === 403)
    return (
      "Your account isn't allowed to create this environment. You need the Power Platform administrator or Dynamics 365 administrator role, " +
      `or your tenant has to allow everyone to create environments.` +
      (msg ? ` (${msg})` : "")
    );
  if (/capacity/i.test(`${code} ${msg}`)) return `Not enough Dataverse capacity in the tenant for a new environment. ${msg}`;
  return msg || `The admin API returned HTTP ${status}${code ? ` (${code})` : ""}`;
}

interface BapEnvironment {
  name?: string;
  properties?: {
    displayName?: string;
    provisioningState?: string;
    linkedEnvironmentMetadata?: { instanceUrl?: string; instanceState?: string };
    states?: { management?: { id?: string } };
  };
}

function readEnv(text: string): BapEnvironment | undefined {
  try {
    const j = JSON.parse(text) as BapEnvironment;
    return j && typeof j === "object" ? j : undefined;
  } catch {
    return undefined;
  }
}

function urlOf(e: BapEnvironment | undefined): string | undefined {
  const raw = e?.properties?.linkedEnvironmentMetadata?.instanceUrl;
  if (!raw) return undefined;
  try {
    return normaliseEnvUrl(raw);
  } catch {
    return undefined;
  }
}

/**
 * Creates the environment and (unless noWait) waits until its Dataverse database is ready.
 * Creation usually takes a few minutes.
 */
export async function createEnvironment(tokens: TokenSource, input: NewEnvironment, opts: CreateOptions = {}): Promise<CreatedEnvironment> {
  const e = validateNewEnvironment(input);
  const fetchImpl = opts.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const now = opts.now ?? Date.now;
  const progress = opts.onProgress ?? (() => {});
  const deadline = now() + (opts.timeoutMs ?? 30 * 60_000);
  const call = async (method: string, url: string, body?: unknown) => {
    const token = await tokens.token(BAP_RESOURCE);
    const res = await fetchImpl(url, {
      method,
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined
    });
    return { res, text: await res.text() };
  };

  progress(`Asking Power Platform to create "${e.displayName}" (${e.type}, ${REGIONS[e.region]})…`);
  const first = await call("POST", `${BAP_HOST}/providers/Microsoft.BusinessAppPlatform/environments?api-version=${BAP_API_VERSION}`, createBody(e));
  if (!first.res.ok) throw new ProvisionError(explain(first.res.status, first.text), first.res.status);
  let env = readEnv(first.text);
  const result = (state: CreatedEnvironment["state"]): CreatedEnvironment => ({ id: env?.name, displayName: e.displayName, url: urlOf(env), state });
  if (first.res.status !== 202 && urlOf(env) && /succeeded/i.test(env?.properties?.provisioningState ?? "Succeeded")) return result("Succeeded");
  if (opts.noWait) return result("Accepted");

  // Long-running: follow the operation link until it finishes.
  let poll = first.res.headers.get("Location") ?? first.res.headers.get("Operation-Location");
  progress("Accepted. Creating the environment and its Dataverse database; this usually takes a few minutes…");
  while (poll) {
    if (now() > deadline) return result("Running");
    const wait = Math.min(Math.max(Number(first.res.headers.get("Retry-After")) || 10, 5), 60) * 1000;
    await sleep(wait);
    const r = await call("GET", safeBapUrl(poll));
    if (r.res.status === 202) {
      poll = r.res.headers.get("Location") ?? poll;
      progress("Still creating…");
      continue;
    }
    if (!r.res.ok) throw new ProvisionError(explain(r.res.status, r.text), r.res.status);
    env = readEnv(r.text) ?? env;
    break;
  }

  // Wait for the Dataverse URL to appear on the environment.
  while (!urlOf(env) || /^(running|creating|accepted|provisioning)$/i.test(env?.properties?.provisioningState ?? "")) {
    if (/failed/i.test(env?.properties?.provisioningState ?? "")) throw new ProvisionError(`Power Platform reported that creating "${e.displayName}" failed.`);
    if (!env?.name || now() > deadline) return result(env?.name ? "Running" : "Accepted");
    await sleep(15_000);
    const r = await call("GET", safeBapUrl(`/providers/Microsoft.BusinessAppPlatform/environments/${encodeURIComponent(env.name)}?api-version=${BAP_API_VERSION}`));
    if (r.res.ok) env = readEnv(r.text) ?? env;
    progress("Waiting for the Dataverse database…");
  }
  progress(`Ready: ${urlOf(env)}`);
  return result("Succeeded");
}
