import type { PrismaTransactionClient } from "@/lib/db/client";

/**
 * Audit logging (§46).
 *
 * Audit rows are written with the SAME transaction client as the change they
 * describe, so a rolled-back change can never leave a phantom audit entry, and
 * a committed change can never lack one.
 */

/** Actions that must be audited at minimum (§46). Extend as modules land. */
export type AuditAction =
  | "PERSON_CREATED"
  | "PERSON_ACTIVATED"
  | "PERSON_DEACTIVATED"
  | "PERSON_UPDATED"
  | "REGISTRATION_APPROVED"
  | "REGISTRATION_REJECTED"
  | "ROLE_CHANGED"
  | "VENTURE_CREATED"
  | "VENTURE_UPDATED"
  | "VENTURE_ARCHIVED"
  | "MEMBERSHIP_ADDED"
  | "MEMBERSHIP_REMOVED"
  | "MEMBERSHIP_ROLE_CHANGED"
  | "TASK_CREATED"
  | "TASK_UPDATED"
  | "TASK_STATUS_CHANGED"
  | "TASK_ARCHIVED"
  | "TIME_ENTRY_ADJUSTED"
  | "DAILY_LOG_SUBMITTED"
  | "DAILY_LOG_APPROVED"
  | "DAILY_LOG_REJECTED"
  | "DAILY_LOG_CORRECTED"
  | "PAY_RATE_CHANGED"
  | "PAYROLL_GENERATED"
  | "PAYROLL_LOCKED"
  | "PAYROLL_VOIDED"
  | "PAYROLL_MARKED_PAID"
  | "DOCUMENT_VERIFIED"
  | "HARDWARE_ISSUED"
  | "HARDWARE_RETURNED";

export type AuditRecord = {
  actorUserId: string | null;
  action: AuditAction;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  reason?: string;
  ipAddress?: string | null;
};

/**
 * Values that must never appear in an audit payload (§64 PII rules).
 * Redacted rather than dropped, so the shape of the change stays visible.
 */
const REDACTED_KEYS = new Set([
  "passwordHash",
  "password",
  "rate",
  "rateSnapshot",
  "computedPay",
  "amount",
  "fixedFee",
]);

/** Strip sensitive values before an object is persisted to the audit log. */
export function redact(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(redact);
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = REDACTED_KEYS.has(k) ? "[redacted]" : redact(v);
    }
    return out;
  }
  // Prisma Decimal and similar objects stringify safely.
  return typeof value === "bigint" ? value.toString() : value;
}

/** Write one audit row using the caller's transaction client. */
export async function writeAudit(
  tx: PrismaTransactionClient,
  record: AuditRecord,
): Promise<void> {
  await tx.auditLog.create({
    data: {
      actorUserId: record.actorUserId,
      action: record.action,
      entityType: record.entityType,
      entityId: record.entityId,
      beforeJson: record.before === undefined ? undefined : (redact(record.before) as never),
      afterJson: record.after === undefined ? undefined : (redact(record.after) as never),
      reason: record.reason,
      ipAddress: record.ipAddress ?? undefined,
    },
  });
}
