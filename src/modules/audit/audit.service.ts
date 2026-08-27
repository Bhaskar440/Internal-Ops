import { prisma } from "@/lib/db/client";
import { forbidden } from "@/lib/errors/appError";
import { isSuperAdmin, type Actor } from "@/lib/permissions/types";

/**
 * Audit log reader (§46).
 *
 * Audit rows are written by the modules that make changes; this only reads
 * them. Rows are never edited or deleted, so the log stays trustworthy.
 */

export type AuditEntry = {
  id: string;
  actorName: string | null;
  action: string;
  entityType: string;
  entityId: string;
  reason: string | null;
  ipAddress: string | null;
  createdAt: Date;
  before: unknown;
  after: unknown;
};

export async function listAuditEntries(
  actor: Actor,
  opts: { action?: string; entityType?: string; entityId?: string; page?: number } = {},
): Promise<{ entries: AuditEntry[]; total: number; page: number; pageSize: number }> {
  if (!isSuperAdmin(actor)) throw forbidden("You are not authorized to view the audit log.");

  const pageSize = 50;
  const page = Math.max(1, opts.page ?? 1);

  const where = {
    ...(opts.action ? { action: opts.action } : {}),
    ...(opts.entityType ? { entityType: opts.entityType } : {}),
    ...(opts.entityId ? { entityId: opts.entityId } : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        action: true,
        entityType: true,
        entityId: true,
        reason: true,
        ipAddress: true,
        createdAt: true,
        beforeJson: true,
        afterJson: true,
        actor: { select: { name: true } },
      },
    }),
    prisma.auditLog.count({ where }),
  ]);

  return {
    entries: rows.map((r) => ({
      id: r.id,
      actorName: r.actor?.name ?? null,
      action: r.action,
      entityType: r.entityType,
      entityId: r.entityId,
      reason: r.reason,
      ipAddress: r.ipAddress,
      createdAt: r.createdAt,
      before: r.beforeJson,
      after: r.afterJson,
    })),
    total,
    page,
    pageSize,
  };
}

/** Distinct action names present in the log, for the filter dropdown. */
export async function listAuditActions(actor: Actor): Promise<string[]> {
  if (!isSuperAdmin(actor)) throw forbidden();
  const rows = await prisma.auditLog.findMany({
    distinct: ["action"],
    select: { action: true },
    orderBy: { action: "asc" },
  });
  return rows.map((r) => r.action);
}
