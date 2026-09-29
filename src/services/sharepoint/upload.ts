import { SharePointRest, aliasQuery } from "./spRest";
import { ItemService, FormValue } from "./items";
import { ValidateOutcome } from "./validateResult";
import { AppError } from "../../utils/errors";
import { log } from "../auth/redact";

/** Files/add handles bodies up to ~250 MB; above that, chunked upload. */
export const CHUNK_THRESHOLD = 250 * 1024 * 1024;
export const CHUNK_SIZE = 10 * 1024 * 1024;

export interface UploadProgress {
    phase: "uploading" | "metadata" | "cleanup" | "done" | "failed" | "skipped";
    /** 0..1 when known (chunked uploads); undefined = indeterminate. */
    fraction?: number;
}

export interface UploadRequest {
    folderServerRelativeUrl: string;
    fileName: string;
    content: Blob;
    /** true only when the user chose Replace. */
    overwrite: boolean;
    formValues: FormValue[];
    checkInComment?: string;
    onProgress?: (p: UploadProgress) => void;
    newGuid?: () => string;
    chunkSize?: number;
    chunkThreshold?: number;
}

export interface UploadResult {
    ok: boolean;
    itemId?: number;
    serverRelativeUrl: string;
    outcome?: ValidateOutcome;
    error?: string;
    /** The orphaned new file was removed after a metadata failure. */
    cleanedUp?: boolean;
}

function guid(): string {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
    });
}

/**
 * Upload sequence (collision decisions happen before this):
 *   upload (simple or chunked) -> validateUpdateListItem(bNewDocumentUpdate, checkInComment)
 *   -> on failure, remove the orphan so nothing is left checked out without metadata.
 */
export class UploadService {
    constructor(
        private readonly sp: SharePointRest,
        private readonly items: ItemService,
    ) {}

    private fileApi(serverRelativeUrl: string, method: string, extra?: Record<string, string>): string {
        const suffix = method ? `/${method}` : "";
        return `web/GetFileByServerRelativePath(decodedurl=@p)${suffix}${aliasQuery({ p: serverRelativeUrl }, extra)}`;
    }

    async upload(req: UploadRequest): Promise<UploadResult> {
        const path = `${req.folderServerRelativeUrl.replace(/\/+$/, "")}/${req.fileName}`;
        const progress = req.onProgress ?? (() => undefined);
        const threshold = req.chunkThreshold ?? CHUNK_THRESHOLD;

        progress({ phase: "uploading", fraction: 0 });
        try {
            if (req.content.size <= threshold) {
                await this.sp.post(
                    `web/GetFolderByServerRelativePath(decodedurl=@f)/Files/AddUsingPath(decodedurl=@n,overwrite=${req.overwrite ? "true" : "false"})${aliasQuery({ f: req.folderServerRelativeUrl, n: req.fileName })}`,
                    req.content,
                );
                progress({ phase: "uploading", fraction: 1 });
            } else {
                await this.chunked(req, path, progress);
            }
        } catch (e) {
            progress({ phase: "failed" });
            return { ok: false, serverRelativeUrl: path, error: (e as Error).message };
        }

        progress({ phase: "metadata" });
        let outcome: ValidateOutcome | undefined;
        let error: string | undefined;
        try {
            const item = await this.sp.get<{ Id: number }>(this.fileApi(path, "ListItemAllFields", { $select: "Id" }));
            outcome = await this.items.validateUpdate(item.Id, req.formValues, { newDocument: true, checkInComment: req.checkInComment ?? "" });
            if (outcome.ok) {
                progress({ phase: "done" });
                return { ok: true, itemId: item.Id, serverRelativeUrl: path, outcome };
            }
            error = [...Object.entries(outcome.fieldErrors).map(([k, v]) => `${k}: ${v}`), ...outcome.generalErrors].join(" ");
        } catch (e) {
            error = (e as Error).message;
        }

        progress({ phase: "cleanup" });
        const cleanedUp = await this.cleanup(path, req.overwrite);
        progress({ phase: "failed" });
        return { ok: false, serverRelativeUrl: path, outcome, error, cleanedUp };
    }

    /**
     * New file: delete the orphan (recycle bin, recoverable). Replaced file:
     * never delete the user's document; undo the checkout our upload created
     * if there is one, which restores the previous version.
     */
    private async cleanup(path: string, replaced: boolean): Promise<boolean> {
        try {
            if (!replaced) {
                await this.sp.post(this.fileApi(path, "recycle()"));
                return true;
            }
            const file = await this.sp.get<{ CheckOutType?: number }>(this.fileApi(path, "", { $select: "CheckOutType" }));
            // CheckOutType: 0 = online (checked out), 2 = none
            if (file?.CheckOutType === 0) await this.sp.post(this.fileApi(path, "UndoCheckOut()"));
            return false;
        } catch (e) {
            log.warn("Upload cleanup failed", e);
            return false;
        }
    }

    private async chunked(req: UploadRequest, path: string, progress: (p: UploadProgress) => void): Promise<void> {
        const size = req.content.size;
        const chunk = req.chunkSize ?? CHUNK_SIZE;
        const uploadId = (req.newGuid ?? guid)();
        // Create (or overwrite) an empty file, then stream into it.
        await this.sp.post(
            `web/GetFolderByServerRelativePath(decodedurl=@f)/Files/AddUsingPath(decodedurl=@n,overwrite=${req.overwrite ? "true" : "false"})${aliasQuery({ f: req.folderServerRelativeUrl, n: req.fileName })}`,
            new ArrayBuffer(0),
        );
        // StartUpload(first chunk) -> ContinueUpload(...) -> FinishUpload(last chunk, offset)
        let offset = 0;
        try {
            const first = req.content.slice(0, Math.min(chunk, size));
            await this.sp.post(this.fileApi(path, `StartUpload(uploadId=guid'${uploadId}')`), first);
            offset = first.size;
            progress({ phase: "uploading", fraction: offset / size });
            for (;;) {
                const end = Math.min(offset + chunk, size);
                const last = end >= size;
                const method = last ? "FinishUpload" : "ContinueUpload";
                await this.sp.post(this.fileApi(path, `${method}(uploadId=guid'${uploadId}',fileOffset=${offset})`), req.content.slice(offset, end));
                offset = end;
                progress({ phase: "uploading", fraction: offset / size });
                if (last) break;
            }
        } catch (e) {
            try {
                await this.sp.post(this.fileApi(path, `CancelUpload(uploadId=guid'${uploadId}')`));
            } catch {
                // best effort
            }
            if (!req.overwrite) {
                await this.sp.post(this.fileApi(path, "recycle()")).catch(() => undefined);
            }
            throw e instanceof AppError ? e : new AppError("http", (e as Error).message);
        }
    }
}
