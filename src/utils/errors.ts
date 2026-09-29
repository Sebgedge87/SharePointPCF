/**
 * Typed errors. The UI maps each `kind` to a distinct state (no auth, popup
 * blocked, no folder, no permission, throttling, ...). Messages must never
 * contain tokens: everything user-visible goes through `redact`.
 */
export type AppErrorKind =
    | "config"
    | "auth-required"
    | "popup-blocked"
    | "auth-cancelled"
    | "auth-failed"
    | "host-not-allowed"
    | "folder-not-found"
    | "no-permission"
    | "not-found"
    | "throttled"
    | "network"
    | "http";

export class AppError extends Error {
    readonly kind: AppErrorKind;
    readonly status?: number;

    constructor(kind: AppErrorKind, message: string, status?: number) {
        super(message);
        this.name = "AppError";
        this.kind = kind;
        this.status = status;
        Object.setPrototypeOf(this, AppError.prototype);
    }
}

export function isAppError(e: unknown, kind?: AppErrorKind): e is AppError {
    return e instanceof AppError && (kind === undefined || e.kind === kind);
}
