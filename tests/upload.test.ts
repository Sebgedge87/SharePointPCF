import { UploadService } from "../src/services/sharepoint/upload";
import { ItemService } from "../src/services/sharepoint/items";
import {
    PlannedFile,
    applyChoiceToAll,
    collisionsResolved,
    detectCollisions,
    initialUploadValues,
    setChoice,
    suggestRename,
    uploadFormValues,
    validateRename,
} from "../src/model/uploadPlan";
import { buildColumns } from "../src/model/columns";
import { DEFAULT_REGIONAL } from "../src/model/regional";
import { fakeFetch, on, Recorded } from "./helpers/fakeFetch";
import { field } from "./helpers/fields";
import { SITE, spFactory } from "./helpers/spFixture";

const FOLDER = "/sites/crm/contact/Jane";
const list = { id: "L", title: "Contact", rootFolderServerRelativeUrl: "/sites/crm/contact", enableVersioning: true, forceCheckout: false };

function service(...handlers: Parameters<typeof fakeFetch>) {
    const f = fakeFetch(...handlers);
    const sp = spFactory(f.fetch)(SITE);
    return { f, svc: new UploadService(sp, new ItemService(sp, list)) };
}

const itemId = on("GET", "/ListItemAllFields", () => ({ Id: 41 }));
const validateOk = on("POST", "ValidateUpdateListItem", () => ({ value: [{ FieldName: "DocType", HasException: false, ItemId: 41 }] }));
const validateFail = on("POST", "ValidateUpdateListItem", () => ({ value: [{ FieldName: "DocType", HasException: true, ErrorMessage: "Invalid choice" }] }));
const methods = (calls: Recorded[]) => calls.map((c) => `${c.method} ${/_api\/(.*?)(\?|$)/.exec(c.url)?.[1]}`);

describe("UploadService", () => {
    it("simple upload -> item id -> validateUpdateListItem with bNewDocumentUpdate + checkInComment", async () => {
        const { f, svc } = service(on("POST", "AddUsingPath", () => ({})), itemId, validateOk);
        const progress: string[] = [];
        const r = await svc.upload({
            folderServerRelativeUrl: FOLDER,
            fileName: "a #1.pdf",
            content: new Blob(["hello"]),
            overwrite: false,
            formValues: [{ FieldName: "DocType", FieldValue: "Contract" }],
            onProgress: (p) => progress.push(p.phase),
        });
        expect(r).toMatchObject({ ok: true, itemId: 41, serverRelativeUrl: `${FOLDER}/a #1.pdf` });
        expect(f.calls[0].url).toContain("AddUsingPath(decodedurl=@n,overwrite=false)?@f='/sites/crm/contact/Jane'&@n='a #1.pdf'");
        expect(f.calls[2].body).toEqual({ formValues: [{ FieldName: "DocType", FieldValue: "Contract" }], bNewDocumentUpdate: true, checkInComment: "" });
        expect(progress).toEqual(["uploading", "uploading", "metadata", "done"]);
    });

    it("recycles the orphan when metadata fails on a new file", async () => {
        const { f, svc } = service(on("POST", "AddUsingPath", () => ({})), itemId, validateFail, on("POST", "recycle()", () => ({})));
        const r = await svc.upload({ folderServerRelativeUrl: FOLDER, fileName: "a.pdf", content: new Blob(["x"]), overwrite: false, formValues: [] });
        expect(r.ok).toBe(false);
        expect(r.cleanedUp).toBe(true);
        expect(r.error).toBe("DocType: Invalid choice");
        expect(methods(f.calls).pop()).toBe("POST web/GetFileByServerRelativePath(decodedurl=@p)/recycle()");
    });

    it("never deletes a replaced file; undoes our checkout instead", async () => {
        const { f, svc } = service(
            on("POST", "AddUsingPath", () => ({})),
            itemId,
            validateFail,
            on("GET", "$select=CheckOutType", () => ({ CheckOutType: 0 })),
            on("POST", "UndoCheckOut()", () => ({})),
        );
        const r = await svc.upload({ folderServerRelativeUrl: FOLDER, fileName: "a.pdf", content: new Blob(["x"]), overwrite: true, formValues: [] });
        expect(r.cleanedUp).toBe(false);
        expect(f.calls[0].url).toContain("overwrite=true");
        expect(f.calls.some((c) => c.url.includes("recycle()"))).toBe(false);
        expect(methods(f.calls).pop()).toBe("POST web/GetFileByServerRelativePath(decodedurl=@p)/UndoCheckOut()");
    });

    it("uses chunked upload above the threshold with correct offsets", async () => {
        const { f, svc } = service(
            on("POST", "AddUsingPath", () => ({})),
            on("POST", "StartUpload", () => ({ value: "4" })),
            on("POST", "ContinueUpload", () => ({ value: "8" })),
            on("POST", "FinishUpload", () => ({})),
            itemId,
            validateOk,
        );
        const fractions: number[] = [];
        const r = await svc.upload({
            folderServerRelativeUrl: FOLDER,
            fileName: "big.bin",
            content: new Blob(["0123456789"]),
            overwrite: false,
            formValues: [],
            chunkThreshold: 5,
            chunkSize: 4,
            newGuid: () => "g",
            onProgress: (p) => p.fraction !== undefined && fractions.push(p.fraction),
        });
        expect(r.ok).toBe(true);
        expect(methods(f.calls).slice(0, 4)).toEqual([
            "POST web/GetFolderByServerRelativePath(decodedurl=@f)/Files/AddUsingPath(decodedurl=@n,overwrite=false)",
            "POST web/GetFileByServerRelativePath(decodedurl=@p)/StartUpload(uploadId=guid'g')",
            "POST web/GetFileByServerRelativePath(decodedurl=@p)/ContinueUpload(uploadId=guid'g',fileOffset=4)",
            "POST web/GetFileByServerRelativePath(decodedurl=@p)/FinishUpload(uploadId=guid'g',fileOffset=8)",
        ]);
        expect((f.calls[1].body as Blob).size).toBe(4);
        expect((f.calls[3].body as Blob).size).toBe(2);
        expect(fractions).toEqual([0, 0.4, 0.8, 1]);
    });

    it("cancels and removes a partial chunked upload", async () => {
        const { f, svc } = service(
            on("POST", "AddUsingPath", () => ({})),
            on("POST", "StartUpload", () => ({})),
            on("POST", "ContinueUpload", () => ({ error: { message: { value: "boom" } } }), 500),
            on("POST", "CancelUpload", () => ({})),
            on("POST", "recycle()", () => ({})),
        );
        const r = await svc.upload({ folderServerRelativeUrl: FOLDER, fileName: "big.bin", content: new Blob(["0123456789"]), overwrite: false, formValues: [], chunkThreshold: 5, chunkSize: 4, newGuid: () => "g" });
        expect(r.ok).toBe(false);
        expect(methods(f.calls).slice(-2)).toEqual([
            "POST web/GetFileByServerRelativePath(decodedurl=@p)/CancelUpload(uploadId=guid'g')",
            "POST web/GetFileByServerRelativePath(decodedurl=@p)/recycle()",
        ]);
    });
});

describe("upload plan", () => {
    const file = (id: string, name: string): PlannedFile => ({ id, file: Object.assign(new Blob(["x"]), { name }), targetName: name, collides: false });
    const existing = ["report.pdf", "report (1).pdf", "notes.txt"];

    it("detects collisions against the live listing and within the batch", () => {
        const plan = detectCollisions([file("1", "Report.PDF"), file("2", "new.docx"), file("3", "new.docx")], existing);
        expect(plan.map((p) => p.collides)).toEqual([true, false, true]);
    });

    it("renames with (n) and validates live", () => {
        const plan = detectCollisions([file("1", "report.pdf"), file("2", "report.pdf")], existing);
        expect(suggestRename(plan[0], plan, existing)).toBe("report (2).pdf");
        const all = applyChoiceToAll(plan, "rename", existing);
        expect(all.map((f) => f.targetName)).toEqual(["report (2).pdf", "report (3).pdf"]);
        expect(collisionsResolved(all, existing, "/f")).toBe(true);
        expect(validateRename("notes.txt", all[0], all, existing, "/f")).toMatch(/already exists/);
        expect(validateRename("report (3).pdf", all[0], all, existing, "/f")).toMatch(/already exists/);
        expect(validateRename("bad?.pdf", all[0], all, existing, "/f")).toMatch(/cannot contain/);
        expect(validateRename("fine.pdf", all[0], all, existing, "/f")).toBeUndefined();
    });

    it("keeps a name edited before the collision for Replace, and renames from it", () => {
        const plan = detectCollisions([{ ...file("1", "scan.pdf"), targetName: "notes.txt" }], existing);
        expect(plan[0].requestedName).toBe("notes.txt");
        const renamed = setChoice(plan, "1", "rename", existing);
        expect(renamed[0].targetName).toBe("notes (1).txt");
        expect(setChoice(renamed, "1", "replace", existing)[0].targetName).toBe("notes.txt");
    });

    it("requires a decision for every collision", () => {
        const plan = detectCollisions([file("1", "report.pdf"), file("2", "x.pdf")], existing);
        expect(collisionsResolved(plan, existing, "/f")).toBe(false);
        expect(collisionsResolved(applyChoiceToAll(plan, "skip", existing), existing, "/f")).toBe(true);
        expect(applyChoiceToAll(plan, "replace", existing)[0]).toMatchObject({ choice: "replace", targetName: "report.pdf" });
    });

    it("builds form values with content type and defaults", () => {
        const fields = [
            field("DocType", "Choice", { Choices: ["A", "B"], Required: true, DefaultValue: "A" }),
            field("Ref", "Text", { Required: true }),
            field("Signed", "Boolean", { Required: true }),
        ];
        const { columns } = buildColumns(["DocType", "Ref", "Signed"], fields, { Ref: { default: "R-1" } });
        const values = initialUploadValues(columns);
        expect(values).toEqual({ DocType: "A", Ref: "R-1", Signed: false });
        const ct = { id: "0x0101", name: "Contract", fieldLinks: {} };
        expect(uploadFormValues(columns, values, ct, true, DEFAULT_REGIONAL)).toEqual([
            { FieldName: "ContentType", FieldValue: "Contract" },
            { FieldName: "DocType", FieldValue: "A" },
            { FieldName: "Ref", FieldValue: "R-1" },
            { FieldName: "Signed", FieldValue: "0" },
        ]);
    });
});
