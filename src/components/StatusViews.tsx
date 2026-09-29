import * as React from "react";
import { Button, MessageBar, MessageBarActions, MessageBarBody, MessageBarTitle, Spinner } from "@fluentui/react-components";
import { AppError, AppErrorKind } from "../utils/errors";

const TITLES: Record<AppErrorKind, string> = {
    config: "Control is not configured correctly",
    "auth-required": "Sign in to SharePoint",
    "popup-blocked": "Sign-in popup was blocked",
    "auth-cancelled": "Sign-in was cancelled",
    "auth-failed": "Sign-in failed",
    "host-not-allowed": "Blocked URL",
    "folder-not-found": "Folder not found",
    "no-permission": "No permission",
    "not-found": "Not found",
    throttled: "SharePoint is busy",
    network: "Network error",
    http: "Something went wrong",
};

const INTENT: Partial<Record<AppErrorKind, "error" | "warning" | "info">> = {
    "auth-required": "info",
    "auth-cancelled": "info",
    "popup-blocked": "warning",
    "folder-not-found": "warning",
    throttled: "warning",
};

export const Loading: React.FC<{ label: string }> = ({ label }) => <Spinner size="small" label={label} labelPosition="after" />;

export interface ErrorStateProps {
    error: AppError;
    onSignIn?: () => void;
    onRetry?: () => void;
    extra?: React.ReactNode;
}

/** Distinct states for no auth, popup blocked, no folder, no permission, throttling, ... */
export const ErrorState: React.FC<ErrorStateProps> = ({ error, onSignIn, onRetry, extra }) => {
    const needsSignIn = error.kind === "auth-required" || error.kind === "popup-blocked" || error.kind === "auth-cancelled" || error.kind === "auth-failed";
    let message = error.message;
    if (error.kind === "no-permission") {
        message = `${error.message} Ask an administrator to grant you (and the app, if the site uses Sites.Selected) access to this SharePoint site.`;
    }
    return (
        <MessageBar intent={INTENT[error.kind] ?? "error"} layout="multiline">
            <MessageBarBody>
                <MessageBarTitle>{TITLES[error.kind]}</MessageBarTitle>
                {message}
                {extra}
            </MessageBarBody>
            <MessageBarActions>
                {needsSignIn && onSignIn && (
                    <Button appearance="primary" onClick={onSignIn}>
                        Sign in
                    </Button>
                )}
                {!needsSignIn && onRetry && <Button onClick={onRetry}>Retry</Button>}
            </MessageBarActions>
        </MessageBar>
    );
};

export const Warnings: React.FC<{ warnings: string[]; onDismiss: () => void }> = ({ warnings, onDismiss }) =>
    warnings.length ? (
        <MessageBar intent="warning" layout="multiline">
            <MessageBarBody>
                <MessageBarTitle>Configuration notes</MessageBarTitle>
                <ul style={{ margin: 0, paddingInlineStart: 16 }}>
                    {warnings.map((w, i) => (
                        <li key={i}>{w}</li>
                    ))}
                </ul>
            </MessageBarBody>
            <MessageBarActions>
                <Button onClick={onDismiss}>Dismiss</Button>
            </MessageBarActions>
        </MessageBar>
    ) : null;
