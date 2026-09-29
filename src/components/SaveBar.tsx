import * as React from "react";
import { Button, MessageBar, MessageBarActions, MessageBarBody, Spinner } from "@fluentui/react-components";

export const SaveBar: React.FC<{ dirtyCount: number; saving: boolean; onSave(): void; onDiscard(): void }> = ({ dirtyCount, saving, onSave, onDiscard }) =>
    dirtyCount > 0 ? (
        <MessageBar intent="info" role="status">
            <MessageBarBody>
                {dirtyCount} unsaved {dirtyCount === 1 ? "row" : "rows"}. Paging, sorting and filtering are paused until you save or discard.
            </MessageBarBody>
            <MessageBarActions>
                <Button appearance="primary" disabled={saving} onClick={onSave} icon={saving ? <Spinner size="extra-tiny" /> : undefined}>
                    Save
                </Button>
                <Button disabled={saving} onClick={onDiscard}>
                    Discard
                </Button>
            </MessageBarActions>
        </MessageBar>
    ) : null;
