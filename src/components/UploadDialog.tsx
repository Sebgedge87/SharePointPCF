import * as React from "react";
import {
    Accordion,
    AccordionHeader,
    AccordionItem,
    AccordionPanel,
    Badge,
    Button,
    Checkbox,
    Dialog,
    DialogActions,
    DialogBody,
    DialogContent,
    DialogSurface,
    DialogTitle,
    Dropdown,
    Field,
    Input,
    MessageBar,
    MessageBarBody,
    Option,
    ProgressBar,
    Radio,
    RadioGroup,
    Text,
    makeStyles,
    tokens,
} from "@fluentui/react-components";
import { GridSession } from "../services/gridLoader";
import { ColumnModel, ContentTypeInfo, uploadColumnsFor } from "../model/columns";
import { EditValue } from "../model/values";
import { validateAll } from "../model/validation";
import {
    CollisionChoice,
    PlannedFile,
    applyChoiceToAll,
    collisionsResolved,
    detectCollisions,
    initialUploadValues,
    setChoice as setChoiceFor,
    uploadFormValues,
    validateRename,
} from "../model/uploadPlan";
import { validateFileName } from "../utils/filename";
import { UploadProgress, UploadService } from "../services/sharepoint/upload";
import { FieldEditor } from "./editors/FieldEditor";
import { toAppError } from "./useGridData";

const useStyles = makeStyles({
    surface: { maxWidth: "760px", width: "95vw" },
    form: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: tokens.spacingHorizontalM },
    stack: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalM },
    row: { display: "flex", alignItems: "center", gap: tokens.spacingHorizontalS, flexWrap: "wrap" },
    name: { flexGrow: 1, minWidth: "160px", overflowWrap: "anywhere" },
    muted: { color: tokens.colorNeutralForeground3 },
    error: { color: tokens.colorPaletteRedForeground1 },
});

type Step = "details" | "collisions" | "progress";

interface FileStatus {
    progress: UploadProgress;
    error?: string;
}

let nextId = 0;

export function toPlanned(files: File[]): PlannedFile[] {
    return files.map((f) => ({ id: `f${++nextId}`, file: f, targetName: f.name, collides: false }));
}

export interface UploadDialogProps {
    session: GridSession;
    files: PlannedFile[];
    onClose(uploadedAny: boolean): void;
}

/**
 * Pre-upload dialog. Sequence: metadata (all required, non-read-only fields of
 * the content type, per file or "apply to all") -> collision check against the
 * live folder listing -> upload -> validateUpdateListItem + check-in -> orphan
 * cleanup on failure. Upload stays disabled until everything is valid.
 */
export const UploadDialog: React.FC<UploadDialogProps> = ({ session, files: initialFiles, onClose }) => {
    const styles = useStyles();
    const cts = session.contentTypes;
    const [ct, setCt] = React.useState<ContentTypeInfo | undefined>(cts[0]);
    const columns = React.useMemo(() => uploadColumnsFor(ct, session.fields, session.columnConfig), [ct, session]);
    const folder = session.folder.folderServerRelativeUrl;

    const [files, setFiles] = React.useState<PlannedFile[]>(initialFiles);
    const [applyAll, setApplyAll] = React.useState(true);
    const [shared, setShared] = React.useState<Record<string, EditValue>>(() => initialUploadValues(columns));
    const [perFile, setPerFile] = React.useState<Record<string, Record<string, EditValue>>>({});
    const [step, setStep] = React.useState<Step>("details");
    const [existing, setExisting] = React.useState<string[]>([]);
    const [collisionAll, setCollisionAll] = React.useState(false);
    const [status, setStatus] = React.useState<Record<string, FileStatus>>({});
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState<string>();
    const [done, setDone] = React.useState(false);
    const uploadedAny = React.useRef(false);

    // content type change: reset values to the new field set
    React.useEffect(() => {
        setShared(initialUploadValues(columns));
        setPerFile({});
    }, [columns]);

    const valuesFor = (id: string) => (applyAll ? shared : (perFile[id] ?? initialUploadValues(columns)));
    const setValue = (id: string | undefined, key: string, v: EditValue) => {
        if (applyAll || !id) setShared((s) => ({ ...s, [key]: v }));
        else setPerFile((p) => ({ ...p, [id]: { ...(p[id] ?? initialUploadValues(columns)), [key]: v } }));
    };
    const errorsFor = (id: string) => validateAll(columns, valuesFor(id), { mode: "upload", folderServerRelativeUrl: folder });
    const nameError = (f: PlannedFile) => validateFileName(f.targetName, folder).error;
    const detailsValid = files.length > 0 && files.every((f) => !Object.keys(errorsFor(f.id)).length && !nameError(f));

    /** Collision check against the live folder listing. */
    const checkCollisions = async (): Promise<PlannedFile[] | undefined> => {
        const live = await session.lists.listFileNames(folder);
        setExisting(live);
        const planned = detectCollisions(files, live);
        setFiles(planned);
        if (planned.some((f) => f.collides && !f.choice)) {
            setStep("collisions");
            return undefined;
        }
        return planned;
    };

    const onContinue = async () => {
        setBusy(true);
        setError(undefined);
        try {
            const planned = await checkCollisions();
            if (planned) await runUploads(planned);
        } catch (e) {
            setError(toAppError(e).message);
        } finally {
            setBusy(false);
        }
    };

    const onCollisionsDone = async () => {
        setBusy(true);
        setError(undefined);
        try {
            // re-check at upload time: something may have appeared meanwhile
            const live = await session.lists.listFileNames(folder);
            const fresh = files.filter((f) => f.choice !== "skip" && f.choice !== "replace" && live.some((n) => n.toLowerCase() === f.targetName.toLowerCase()));
            if (fresh.length) {
                setExisting(live);
                setFiles(detectCollisions(files, live));
                setError("New files with the same names appeared in the folder. Review the conflicts again.");
                return;
            }
            await runUploads(files);
        } catch (e) {
            setError(toAppError(e).message);
        } finally {
            setBusy(false);
        }
    };

    const runUploads = async (planned: PlannedFile[]) => {
        setStep("progress");
        const uploader = new UploadService(session.sp, session.items);
        const includeCt = cts.length > 1;
        let any = false;
        for (const f of planned) {
            if (f.choice === "skip") {
                setStatus((s) => ({ ...s, [f.id]: { progress: { phase: "skipped" } } }));
                continue;
            }
            const result = await uploader.upload({
                folderServerRelativeUrl: folder,
                fileName: f.targetName,
                content: f.file,
                overwrite: f.choice === "replace",
                formValues: uploadFormValues(columns, valuesFor(f.id), ct, includeCt, session.regional),
                checkInComment: "Uploaded from Dynamics 365",
                onProgress: (progress) => setStatus((s) => ({ ...s, [f.id]: { ...s[f.id], progress } })),
            });
            if (result.ok) any = true;
            else {
                const note = result.cleanedUp ? " The file was removed so nothing is left without metadata." : "";
                setStatus((s) => ({ ...s, [f.id]: { progress: { phase: "failed" }, error: `${result.error ?? "Upload failed."}${note}` } }));
            }
        }
        setDone(true);
        uploadedAny.current = any;
    };

    const setChoice = (f: PlannedFile, choice: CollisionChoice) => {
        if (collisionAll) {
            setFiles((all) => applyChoiceToAll(all, choice, existing));
            return;
        }
        setFiles((all) => setChoiceFor(all, f.id, choice, existing));
    };

    const renderForm = (id?: string) => (
        <div className={styles.form}>
            {columns.map((c: ColumnModel) => (
                <FieldEditor
                    key={c.key}
                    label={c.label}
                    required={c.requiredOnUpload}
                    column={c}
                    value={id ? valuesFor(id)[c.key] : shared[c.key]}
                    onChange={(v) => setValue(id, c.key, v)}
                    error={id ? errorsFor(id)[c.key] : errorsFor(files[0]?.id ?? "")[c.key]}
                    fallback={<Text className={styles.muted}>{c.label}: not editable here</Text>}
                />
            ))}
        </div>
    );

    const title = step === "collisions" ? "Files already exist" : step === "progress" ? (done ? "Upload finished" : "Uploading…") : `Upload ${files.length} ${files.length === 1 ? "file" : "files"}`;

    return (
        <Dialog open modalType="alert" onOpenChange={(_, d) => !d.open && !busy && onClose(uploadedAny.current)}>
            <DialogSurface className={styles.surface}>
                <DialogBody>
                    <DialogTitle>{title}</DialogTitle>
                    <DialogContent className={styles.stack}>
                        {error && (
                            <MessageBar intent="error">
                                <MessageBarBody>{error}</MessageBarBody>
                            </MessageBar>
                        )}

                        {step === "details" && (
                            <>
                                {cts.length > 1 && (
                                    <Field label="Content type" required>
                                        <Dropdown value={ct?.name ?? ""} selectedOptions={ct ? [ct.id] : []} onOptionSelect={(_, d) => setCt(cts.find((c) => c.id === d.optionValue))}>
                                            {cts.map((c) => (
                                                <Option key={c.id} value={c.id}>
                                                    {c.name}
                                                </Option>
                                            ))}
                                        </Dropdown>
                                    </Field>
                                )}
                                {files.map((f) => (
                                    <Field key={f.id} validationState={nameError(f) ? "error" : "none"} validationMessage={nameError(f)}>
                                        <div className={styles.row}>
                                            <Input
                                                className={styles.name}
                                                size="small"
                                                aria-label="File name"
                                                value={f.targetName}
                                                onChange={(_, d) => setFiles((all) => all.map((x) => (x.id === f.id ? { ...x, targetName: d.value } : x)))}
                                            />
                                            <Text size={200} className={styles.muted}>
                                                {formatSize(f.file.size)}
                                            </Text>
                                            <Button size="small" appearance="subtle" onClick={() => setFiles((all) => all.filter((x) => x.id !== f.id))}>
                                                Remove
                                            </Button>
                                        </div>
                                    </Field>
                                ))}
                                {columns.length === 0 ? (
                                    <Text className={styles.muted}>No metadata is required for this content type.</Text>
                                ) : (
                                    <>
                                        {files.length > 1 && (
                                            <Checkbox checked={applyAll} onChange={(_, d) => setApplyAll(d.checked === true)} label="Apply the same values to all files" />
                                        )}
                                        {applyAll || files.length === 1 ? (
                                            renderForm(files.length === 1 ? files[0].id : undefined)
                                        ) : (
                                            <Accordion multiple collapsible defaultOpenItems={files[0]?.id}>
                                                {files.map((f) => {
                                                    const n = Object.keys(errorsFor(f.id)).length;
                                                    return (
                                                        <AccordionItem key={f.id} value={f.id}>
                                                            <AccordionHeader>
                                                                {f.targetName}&nbsp;
                                                                {n > 0 && (
                                                                    <Badge color="danger" size="small">
                                                                        {n}
                                                                    </Badge>
                                                                )}
                                                            </AccordionHeader>
                                                            <AccordionPanel>{renderForm(f.id)}</AccordionPanel>
                                                        </AccordionItem>
                                                    );
                                                })}
                                            </Accordion>
                                        )}
                                    </>
                                )}
                            </>
                        )}

                        {step === "collisions" && (
                            <>
                                {!session.list.enableVersioning && (
                                    <MessageBar intent="warning">
                                        <MessageBarBody>Versioning is off in this library: Replace permanently overwrites the existing file.</MessageBarBody>
                                    </MessageBar>
                                )}
                                {files.filter((f) => f.collides).length > 1 && (
                                    <Checkbox checked={collisionAll} onChange={(_, d) => setCollisionAll(d.checked === true)} label="Apply my choice to all conflicts" />
                                )}
                                {files
                                    .filter((f) => f.collides)
                                    .map((f) => {
                                        const renameError = f.choice === "rename" ? validateRename(f.targetName, f, files, existing, folder) : undefined;
                                        return (
                                            <div key={f.id} className={styles.stack}>
                                                <Text weight="semibold">{f.requestedName ?? f.targetName}</Text>
                                                <RadioGroup layout="horizontal" value={f.choice ?? ""} onChange={(_, d) => setChoice(f, d.value as CollisionChoice)}>
                                                    <Radio value="replace" label="Replace" />
                                                    <Radio value="rename" label="Keep both (rename)" />
                                                    <Radio value="skip" label="Skip" />
                                                </RadioGroup>
                                                {f.choice === "rename" && (
                                                    <Field label="New name" validationState={renameError ? "error" : "success"} validationMessage={renameError ?? "Name is available"}>
                                                        <Input
                                                            value={f.targetName}
                                                            onChange={(_, d) => setFiles((all) => all.map((x) => (x.id === f.id ? { ...x, targetName: d.value } : x)))}
                                                        />
                                                    </Field>
                                                )}
                                            </div>
                                        );
                                    })}
                            </>
                        )}

                        {step === "progress" &&
                            files.map((f) => {
                                const s = status[f.id];
                                const phase = s?.progress.phase ?? "uploading";
                                return (
                                    <Field
                                        key={f.id}
                                        label={f.targetName}
                                        validationState={phase === "failed" ? "error" : phase === "done" ? "success" : "none"}
                                        validationMessage={s?.error ?? PHASE_TEXT[phase]}
                                    >
                                        <ProgressBar
                                            value={phase === "done" || phase === "failed" || phase === "skipped" ? 1 : phase === "uploading" ? s?.progress.fraction : undefined}
                                            color={phase === "failed" ? "error" : phase === "done" ? "success" : "brand"}
                                        />
                                    </Field>
                                );
                            })}
                    </DialogContent>
                    <DialogActions>
                        {step === "details" && (
                            <>
                                <Button appearance="primary" disabled={!detailsValid || busy} onClick={() => void onContinue()}>
                                    Upload
                                </Button>
                                <Button disabled={busy} onClick={() => onClose(false)}>
                                    Cancel
                                </Button>
                            </>
                        )}
                        {step === "collisions" && (
                            <>
                                <Button appearance="primary" disabled={busy || !collisionsResolved(files, existing, folder)} onClick={() => void onCollisionsDone()}>
                                    Upload
                                </Button>
                                <Button disabled={busy} onClick={() => setStep("details")}>
                                    Back
                                </Button>
                            </>
                        )}
                        {step === "progress" && (
                            <Button appearance="primary" disabled={!done} onClick={() => onClose(uploadedAny.current)}>
                                Close
                            </Button>
                        )}
                    </DialogActions>
                </DialogBody>
            </DialogSurface>
        </Dialog>
    );
};

const PHASE_TEXT: Record<UploadProgress["phase"], string> = {
    uploading: "Uploading…",
    metadata: "Saving properties and checking in…",
    cleanup: "Cleaning up…",
    done: "Uploaded",
    failed: "Failed",
    skipped: "Skipped",
};

function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
