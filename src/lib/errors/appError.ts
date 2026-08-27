/**
 * Consistent error structure (§70).
 *
 * Every error carries a stable machine-readable `code` so the UI can show a
 * meaningful message ("another timer is already running") instead of a generic
 * 500. Messages here are safe to show to the caller; never put PII or SQL in them.
 */

export type AppErrorCode =
  | "UNAUTHENTICATED"
  | "ACCOUNT_PENDING"
  | "ACCOUNT_SUSPENDED"
  | "ACCOUNT_INACTIVE"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION_FAILED"
  | "CONFLICT"
  | "ACTIVE_TIMER_EXISTS"
  | "EDIT_WINDOW_CLOSED"
  | "INVALID_TRANSITION"
  | "INTERNAL";

const STATUS: Record<AppErrorCode, number> = {
  UNAUTHENTICATED: 401,
  ACCOUNT_PENDING: 403,
  ACCOUNT_SUSPENDED: 403,
  ACCOUNT_INACTIVE: 403,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION_FAILED: 422,
  CONFLICT: 409,
  ACTIVE_TIMER_EXISTS: 409,
  EDIT_WINDOW_CLOSED: 409,
  INVALID_TRANSITION: 409,
  INTERNAL: 500,
};

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: AppErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = STATUS[code];
    this.details = details;
  }
}

export const unauthenticated = () =>
  new AppError("UNAUTHENTICATED", "You must sign in to continue.");

export const forbidden = (message = "You do not have permission to do that.") =>
  new AppError("FORBIDDEN", message);

export const notFound = (what = "Record") =>
  new AppError("NOT_FOUND", `${what} not found.`);

export const conflict = (message: string) => new AppError("CONFLICT", message);

export const validationFailed = (message: string, details?: unknown) =>
  new AppError("VALIDATION_FAILED", message, details);

/** Maps an account status to the error explaining why access is refused (§7). */
export function accountStatusError(status: string): AppError | null {
  switch (status) {
    case "ACTIVE":
      return null;
    case "PENDING":
      return new AppError(
        "ACCOUNT_PENDING",
        "Your account is awaiting administrator approval.",
      );
    case "SUSPENDED":
      return new AppError("ACCOUNT_SUSPENDED", "Your account has been suspended.");
    case "INACTIVE":
      return new AppError("ACCOUNT_INACTIVE", "Your account is no longer active.");
    default:
      return new AppError("FORBIDDEN", "Your account cannot access this resource.");
  }
}

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}

/** Serialize for an API response — never leaks internals. */
export function toErrorResponse(e: unknown): { status: number; body: { error: { code: string; message: string; details?: unknown } } } {
  if (isAppError(e)) {
    return {
      status: e.status,
      body: { error: { code: e.code, message: e.message, details: e.details } },
    };
  }
  return {
    status: 500,
    body: { error: { code: "INTERNAL", message: "Something went wrong." } },
  };
}
