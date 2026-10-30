import { appendAction } from "./actionLog.js";
import { checkPolicy } from "./components.js";
import { assertGuid, type DataverseClient } from "./dataverse.js";
import { requireAccess } from "./access.js";

export const ENV_VAR_TYPES: Record<number, string> = {
  100000000: "Text",
  100000001: "Number",
  100000002: "Yes/No",
  100000003: "JSON",
  100000004: "Data source",
  100000005: "Secret"
};
const SECRET = 100000005;

export interface EnvVar {
  definitionId: string;
  schemaName: string;
  displayName: string;
  type: string;
  secret: boolean;
  defaultValue?: string;
  /** The environment's own value (overrides the default). */
  currentValue?: string;
  valueId?: string;
  /** The value flows and apps will use. */
  effective?: string;
  missing: boolean;
}

interface RawDef {
  environmentvariabledefinitionid: string;
  schemaname: string;
  displayname?: string;
  type?: number;
  defaultvalue?: string | null;
  isrequired?: boolean;
  environmentvariabledefinition_environmentvariablevalue?: { environmentvariablevalueid: string; value?: string | null }[];
}

/** Environment variables with their default, current and effective values. Secret values are never read. */
export async function listEnvVars(client: DataverseClient): Promise<EnvVar[]> {
  const rows = await client.getAll<RawDef>(
    "environmentvariabledefinitions?$select=environmentvariabledefinitionid,schemaname,displayname,type,defaultvalue,isrequired" +
      "&$expand=environmentvariabledefinition_environmentvariablevalue($select=environmentvariablevalueid,value)&$orderby=schemaname"
  );
  return rows.map((r) => {
    const secret = r.type === SECRET;
    const v = r.environmentvariabledefinition_environmentvariablevalue?.[0];
    const current = secret ? undefined : (v?.value ?? undefined) || undefined;
    const def = secret ? undefined : r.defaultvalue || undefined;
    return {
      definitionId: r.environmentvariabledefinitionid,
      schemaName: r.schemaname,
      displayName: r.displayname || r.schemaname,
      type: ENV_VAR_TYPES[r.type ?? 0] ?? "Text",
      secret,
      defaultValue: def,
      currentValue: current,
      valueId: v?.environmentvariablevalueid,
      effective: current ?? def,
      missing: secret ? false : !(current ?? def)
    };
  });
}

/** Sets (or creates) an environment variable's current value in one environment. */
export async function setEnvVarValue(
  client: DataverseClient,
  schemaName: string,
  value: string,
  opts: { reason?: string; actor?: string; source: "cli" | "dashboard" },
  log = appendAction
): Promise<void> {
  checkPolicy(client.env, opts.reason);
  await requireAccess(client, "customize", "set environment variables");
  if (value.length > 100_000) throw new Error("Value is too long");
  const vars = await listEnvVars(client);
  const v = vars.find((x) => x.schemaName === schemaName);
  if (!v) throw new Error(`No environment variable "${schemaName}" in ${client.env.name}`);
  if (v.secret) throw new Error("Secret variables are managed in Azure Key Vault, not here");
  let ok = true;
  let error: string | undefined;
  try {
    if (v.valueId) await client.update("environmentvariablevalues", v.valueId, { value });
    else {
      assertGuid(v.definitionId);
      await client.request("POST", "environmentvariablevalues", {
        schemaname: `${schemaName}_value`,
        value,
        "EnvironmentVariableDefinitionId@odata.bind": `/environmentvariabledefinitions(${v.definitionId})`
      });
    }
  } catch (e) {
    ok = false;
    error = (e as Error).message;
  }
  log({ at: new Date().toISOString(), env: client.env.name, action: "set variable", kind: "envvar", id: v.definitionId, name: schemaName, reason: opts.reason?.trim() || undefined, actor: opts.actor, source: opts.source, ok, error });
  if (!ok) throw new Error(error);
}

export interface ConnectionRef {
  id: string;
  logicalName: string;
  displayName: string;
  connector: string;
  connected: boolean;
  connectionId?: string;
}

/** Connection references and whether each has a connection in this environment. */
export async function listConnectionRefs(client: DataverseClient): Promise<ConnectionRef[]> {
  const rows = await client.getAll<{ connectionreferenceid: string; connectionreferencelogicalname: string; connectionreferencedisplayname?: string; connectorid?: string; connectionid?: string | null }>(
    "connectionreferences?$select=connectionreferenceid,connectionreferencelogicalname,connectionreferencedisplayname,connectorid,connectionid&$orderby=connectionreferencelogicalname"
  );
  return rows.map((r) => ({
    id: r.connectionreferenceid,
    logicalName: r.connectionreferencelogicalname,
    displayName: r.connectionreferencedisplayname || r.connectionreferencelogicalname,
    connector: (r.connectorid ?? "").split("/").pop()?.replace(/^shared_/, "") ?? "",
    connected: !!r.connectionid,
    connectionId: r.connectionid ?? undefined
  }));
}
