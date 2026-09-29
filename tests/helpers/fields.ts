import { FieldSchema, normalizeField } from "../../src/model/fieldSchema";

export function field(internalName: string, typeAsString: string, extra: Record<string, unknown> = {}): FieldSchema {
    return normalizeField({ Id: internalName, InternalName: internalName, Title: internalName, TypeAsString: typeAsString, ...extra });
}
