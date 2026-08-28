import { prisma, type PrismaTransactionClient } from "@/lib/db/client";
import { forbidden, notFound } from "@/lib/errors/appError";
import { isSuperAdmin, type Actor } from "@/lib/permissions/types";
import type { NotificationKind } from "@/generated/prisma/enums";

/**
 * In-app notifications (§59 Phase 1).
 *
 * Notifications are addressed to a PERSON and are only ever readable by that
 * person — there is no "read someone else's alerts" path, because every query
 * here is bound to the caller's own personId.
 *
 * `dedupeKey` keeps a recurring condition to one row. A task that is still
 * overdue tomorrow updates its existing notification rather than adding a
 * second one, so the centre stays useful instead of becoming a wall of noise.
 */

export type NotificationView = {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  link: string | null;
  read: boolean;
  createdAt: Date;
};

/**
 * Create or refresh one notification.
 *
 * Takes an optional transaction client so a notification commits together with
 * the change that caused it — a task assignment that rolls back must not leave
 * an alert claiming it happened.
 */
export async function notify(
  args: {
    personId: string;
    kind: NotificationKind;
    title: string;
    body?: string;
    link?: string;
    dedupeKey: string;
  },
  tx?: PrismaTransactionClient,
): Promise<void> {
  const db = tx ?? prisma;

  await db.notification.upsert({
    where: {
      personId_dedupeKey: { personId: args.personId, dedupeKey: args.dedupeKey },
    },
    // A repeat of the same condition refreshes the text and marks it unread
    // again, so a still-unresolved problem does not quietly disappear.
    update: {
      title: args.title,
      body: args.body,
      link: args.link,
      readAt: null,
      createdAt: new Date(),
    },
    create: {
      personId: args.personId,
      kind: args.kind,
      title: args.title,
      body: args.body,
      link: args.link,
      dedupeKey: args.dedupeKey,
    },
  });
}

/** Notify several people of the same thing, e.g. every assignee of a task. */
export async function notifyMany(
  personIds: string[],
  build: (personId: string) => Parameters<typeof notify>[0],
  tx?: PrismaTransactionClient,
): Promise<void> {
  for (const personId of personIds) {
    await notify(build(personId), tx);
  }
}

/** The caller's own notifications, newest first. */
export async function listMyNotifications(
  actor: Actor,
  opts: { unreadOnly?: boolean; limit?: number } = {},
): Promise<NotificationView[]> {
  if (!actor.personId) return [];

  const rows = await prisma.notification.findMany({
    where: {
      personId: actor.personId,
      ...(opts.unreadOnly ? { readAt: null } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: opts.limit ?? 50,
    select: {
      id: true,
      kind: true,
      title: true,
      body: true,
      link: true,
      readAt: true,
      createdAt: true,
    },
  });

  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    title: r.title,
    body: r.body,
    link: r.link,
    read: r.readAt !== null,
    createdAt: r.createdAt,
  }));
}

/** Unread count for the header badge. */
export async function unreadCount(actor: Actor): Promise<number> {
  if (!actor.personId) return 0;
  return prisma.notification.count({
    where: { personId: actor.personId, readAt: null },
  });
}

/** Mark one notification read. Only the owner can. */
export async function markRead(actor: Actor, notificationId: string): Promise<void> {
  if (!actor.personId) throw forbidden();

  const existing = await prisma.notification.findUnique({
    where: { id: notificationId },
    select: { personId: true },
  });
  if (!existing) throw notFound("Notification");
  if (existing.personId !== actor.personId) throw notFound("Notification");

  await prisma.notification.update({
    where: { id: notificationId },
    data: { readAt: new Date() },
  });
}

export async function markAllRead(actor: Actor): Promise<number> {
  if (!actor.personId) return 0;
  const result = await prisma.notification.updateMany({
    where: { personId: actor.personId, readAt: null },
    data: { readAt: new Date() },
  });
  return result.count;
}

/**
 * Sweep for conditions nobody has explicitly triggered: tasks falling due,
 * overdue work, missing daily logs, expiring documents and pending accounts.
 *
 * Written to be safe to run repeatedly — the dedupe key means a second run on
 * the same day updates rather than duplicates. Called by the nightly job.
 */
export async function generateScheduledNotifications(): Promise<number> {
  const now = new Date();
  const soon = new Date(now.getTime() + 2 * 24 * 3600 * 1000);
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  let created = 0;

  // --- tasks due soon and overdue -----------------------------------------
  const openTasks = await prisma.task.findMany({
    where: {
      archivedAt: null,
      status: { not: "DONE" },
      dueDate: { not: null, lte: soon },
    },
    select: {
      id: true,
      title: true,
      dueDate: true,
      venture: { select: { name: true } },
      assignees: { select: { personId: true } },
    },
  });

  for (const task of openTasks) {
    const overdue = task.dueDate! < today;
    for (const a of task.assignees) {
      await notify({
        personId: a.personId,
        kind: overdue ? "TASK_OVERDUE" : "TASK_DUE_SOON",
        title: overdue ? `Overdue: ${task.title}` : `Due soon: ${task.title}`,
        body: `${task.venture.name} · due ${task.dueDate!.toISOString().slice(0, 10)}`,
        link: `/tasks/${task.id}`,
        dedupeKey: `task:${task.id}:${overdue ? "overdue" : "due-soon"}`,
      });
      created++;
    }
  }

  // --- documents expiring within 30 days ----------------------------------
  const expiring = await prisma.documentRecord.findMany({
    where: {
      expiryDate: {
        not: null,
        lte: new Date(now.getTime() + 30 * 24 * 3600 * 1000),
      },
      status: { notIn: ["REJECTED"] },
    },
    select: { id: true, personId: true, docType: true, expiryDate: true },
  });

  for (const doc of expiring) {
    const expired = doc.expiryDate! < today;
    await notify({
      personId: doc.personId,
      kind: "DOCUMENT_EXPIRING",
      title: expired ? `${doc.docType} has expired` : `${doc.docType} expires soon`,
      body: `Expiry ${doc.expiryDate!.toISOString().slice(0, 10)}`,
      link: "/hr",
      dedupeKey: `doc:${doc.id}:expiry`,
    });
    created++;
  }

  // --- accounts awaiting approval, to every Super Admin --------------------
  const pendingCount = await prisma.user.count({
    where: { accountStatus: "PENDING" },
  });

  if (pendingCount > 0) {
    const admins = await prisma.person.findMany({
      where: { archivedAt: null, user: { globalRole: "SUPER_ADMIN", accountStatus: "ACTIVE" } },
      select: { id: true },
    });
    for (const admin of admins) {
      await notify({
        personId: admin.id,
        kind: "ACCOUNT_AWAITING_APPROVAL",
        title: `${pendingCount} account${pendingCount === 1 ? "" : "s"} awaiting approval`,
        body: "People cannot access any venture until approved.",
        link: "/people?status=PENDING",
        dedupeKey: "accounts:pending",
      });
      created++;
    }
  }

  return created;
}

/** Housekeeping: drop read notifications older than 30 days. */
export async function pruneNotifications(): Promise<number> {
  const cutoff = new Date(Date.now() - 30 * 24 * 3600 * 1000);
  const result = await prisma.notification.deleteMany({
    where: { readAt: { not: null, lt: cutoff } },
  });
  return result.count;
}

/** Admin-only view of what a person would see, for support purposes. */
export async function countFor(actor: Actor, personId: string): Promise<number> {
  if (!isSuperAdmin(actor)) throw forbidden();
  return prisma.notification.count({ where: { personId, readAt: null } });
}
