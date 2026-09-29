import { DataverseApi } from "../../src/services/dataverse/folderResolver";

type Rec = Record<string, unknown>;

/** In-memory Dataverse: tables of records keyed by id; filters supported: `field eq value` joined by `and`. */
export function fakeDataverse(tables: Record<string, Rec[]>) {
    const idField = (entity: string) => `${entity}id`;
    const created: { entity: string; data: Rec }[] = [];
    const api: jest.Mocked<DataverseApi> = {
        retrieveMultipleRecords: jest.fn(async (entity: string, options?: string) => {
            const rows = tables[entity] ?? [];
            const filter = /\$filter=([^&]+)/.exec(options ?? "")?.[1] ?? "";
            const conds = filter
                .split(" and ")
                .map((c) => /^(\S+) eq (.+)$/.exec(c.trim()))
                .filter((m): m is RegExpExecArray => !!m);
            return {
                entities: rows.filter((r) =>
                    conds.every(([, f, v]) => String(r[f] ?? "").toLowerCase() === v.replace(/^'|'$/g, "").toLowerCase()),
                ),
            };
        }),
        retrieveRecord: jest.fn(async (entity: string, id: string) => {
            const row = (tables[entity] ?? []).find((r) => String(r[idField(entity)]).toLowerCase() === id.toLowerCase());
            if (!row) throw new Error(`${entity} ${id} not found`);
            return row;
        }),
        createRecord: jest.fn(async (entity: string, data: Rec) => {
            created.push({ entity, data });
            return { id: `new-${created.length}` };
        }),
    };
    return { api, created };
}

export const LT = "@Microsoft.Dynamics.CRM.lookuplogicalname";
