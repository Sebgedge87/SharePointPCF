import { appendAction } from "./actionLog.js";
import { checkPolicy } from "./components.js";
import { assertGuid, type DataverseClient } from "./dataverse.js";
import { fv, mapLimit } from "./util.js";

/** asyncoperation.statecode: 0 Ready, 1 Suspended, 2 Locked (in progress), 3 Completed */
export type JobProblem = "failed" | "suspended" | "waiting" | "long-running";

export interface Job {
  id: string;
  name: string;
  type: string;
  status: string;
  problem: JobProblem;
  created: string;
  started?: string;
  message?: string;
  regarding?: string;
  retries?: number;
}

/**
 * Background jobs (system jobs) that need attention: failed, suspended, waiting for over an hour,
 * or running for over two hours.
 */
export async function listProblemJobs(client: DataverseClient, since: Date, now = new Date(), max = 1000): Promise<Job[]> {
  const hourAgo = new Date(now.getTime() - 3_600_000).toISOString();
  const twoHoursAgo = new Date(now.getTime() - 7_200_000).toISOString();
  const filter =
    `createdon ge ${since.toISOString()} and (statuscode eq 31 or statecode eq 1 or (statecode eq 0 and createdon le ${hourAgo})` +
    ` or (statuscode eq 20 and startedon le ${twoHoursAgo}))`;
  const rows = await client.getAll<Record<string, unknown>>(
    `asyncoperations?$select=asyncoperationid,name,operationtype,statuscode,statecode,message,friendlymessage,createdon,startedon,retrycount,_regardingobjectid_value&$filter=${filter}&$orderby=createdon desc`,
    max
  );
  return rows.map((r) => {
    const statuscode = Number(r.statuscode);
    const statecode = Number(r.statecode);
    const problem: JobProblem = statuscode === 31 ? "failed" : statecode === 1 ? "suspended" : statuscode === 20 ? "long-running" : "waiting";
    return {
      id: String(r.asyncoperationid),
      name: String(r.name ?? ""),
      type: fv(r, "operationtype") ?? String(r.operationtype ?? ""),
      status: fv(r, "statuscode") ?? String(statuscode),
      problem,
      created: String(r.createdon ?? ""),
      started: r.startedon ? String(r.startedon) : undefined,
      message: String(r.friendlymessage || r.message || "") || undefined,
      regarding: fv(r, "_regardingobjectid_value"),
      retries: r.retrycount !== undefined ? Number(r.retrycount) : undefined
    };
  });
}

export type JobAction = "cancel" | "resume";

const BODY: Record<JobAction, Record<string, number>> = {
  cancel: { statecode: 3, statuscode: 32 },
  resume: { statecode: 0, statuscode: 0 }
};

export async function changeJobs(
  client: DataverseClient,
  jobs: { id: string; name: string }[],
  action: JobAction,
  opts: { reason?: string; actor?: string; source: "cli" | "dashboard" },
  log = appendAction
): Promise<{ id: string; name: string; ok: boolean; error?: string }[]> {
  checkPolicy(client.env, opts.reason);
  jobs.forEach((j) => assertGuid(j.id));
  return mapLimit(jobs, 4, async (j) => {
    let ok = true;
    let error: string | undefined;
    try {
      await client.update("asyncoperations", j.id, BODY[action]);
    } catch (e) {
      ok = false;
      error = (e as Error).message;
    }
    log({ at: new Date().toISOString(), env: client.env.name, action: `job ${action}`, kind: "job", id: j.id, name: j.name, reason: opts.reason?.trim() || undefined, actor: opts.actor, source: opts.source, ok, error });
    return { id: j.id, name: j.name, ok, error };
  });
}
