import * as React from "react";
import { Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, MessageBar, MessageBarBody } from "@fluentui/react-components";
import { RenderRow } from "../services/sharepoint/items";
import { toAppError } from "./useGridData";

export interface DeleteDialogProps {
    row: RenderRow;
    onConfirm(): Promise<void>;
    onClose(deleted: boolean): void;
}

/** Delete = items(id)/recycle(): the file goes to the site recycle bin and can be restored. */
export const DeleteDialog: React.FC<DeleteDialogProps> = ({ row, onConfirm, onClose }) => {
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState<string>();
    const name = String(row.FileLeafRef ?? "this file");
    return (
        <Dialog open modalType="alert" onOpenChange={(_, d) => !d.open && !busy && onClose(false)}>
            <DialogSurface>
                <DialogBody>
                    <DialogTitle>Delete file?</DialogTitle>
                    <DialogContent>
                        “{name}” will be moved to the SharePoint recycle bin.
                        {error && (
                            <MessageBar intent="error">
                                <MessageBarBody>{error}</MessageBarBody>
                            </MessageBar>
                        )}
                    </DialogContent>
                    <DialogActions>
                        <Button
                            appearance="primary"
                            disabled={busy}
                            onClick={async () => {
                                setBusy(true);
                                setError(undefined);
                                try {
                                    await onConfirm();
                                    onClose(true);
                                } catch (e) {
                                    setError(toAppError(e).message);
                                    setBusy(false);
                                }
                            }}
                        >
                            Delete
                        </Button>
                        <Button disabled={busy} onClick={() => onClose(false)}>
                            Cancel
                        </Button>
                    </DialogActions>
                </DialogBody>
            </DialogSurface>
        </Dialog>
    );
};
