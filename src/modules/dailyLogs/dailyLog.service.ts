import { prisma, type PrismaTransactionClient } from "@/lib/db/client";
import { formatMinutes } from "@/lib/money/efficiency";
import { writeAudit } from "@/lib/audit/audit";
import { AppError, conflict, forbidden, notFound } from "@/lib/errors/appError";
import { ventureIdScope } from "@/lib/permissions/scopes";
import { isSuperAdmin, type Actor, type ActorWithVenture } from "@/lib/permissions/types";
import {
  currentBusinessDate,
  fromPrismaDate,
  isWithinEditWindow,
  isWorkingDay,
  toPrismaDate,
  businessDayEnd,
  type BusinessDate,
} from "@/lib/timezone/businessDate";
import {
  listEntriesForDay,
  listEntriesForLogs,
  type TimeEntryView,
} from "@/modules/time/time.service";
import { notify, notifyMany } from "@/modules/notifications/notification.service";

/**
 * Daily logs / timesheets (§26-§32).
 *
 * The log owns attendance and workflow ONLY. Hours are always a projection
 * over TimeEntry — there is no total column, so timer and manual time can
 * never be double counted (§27).
 */

export type DailyLogView = {
  id: string;
  personId: string;
  personName: string;
  ventureId: string;
  ventureName: string;
  ventureTagColor: string;
  businessDate: BusinessDate;
  attendanceStatus: string;
  status: string;
  generalNote: string | null;
  submittedAt: Date | null;
  approvedAt: Date | null;
  rejectionReason: string | null;
  entries: TimeEntryView[];
  totalMinutes: number;
  editable: boolean;
  editWindowClosesAt: Date;
  /** §30: attendance says away but hours were logged. */
  attendanceConflict: boolean;
};

const logSelect = {
  id: true,
  personId: true,
  ventureId: true,
  businessDate: true,
  attendanceStatus: true,
  status: true,
  generalNote: true,
  submittedAt: true,
  approvedAt: true,
  rejectionReason: true,
  person: { select: { user: { select: { name: true } } } },
  venture: {
    select: {
      id: true,
      name: true,
      tagColor: true,
      timezone: true,
      dailyLogEditWindowHours: true,
      workingDays: true,
    },
  },
} as const;

type LogRow = {
  id: string;
  personId: string;
  ventureId: string;
  businessDate: Date;
  attendanceStatus: string;
  status: string;
  generalNote: string | null;
  submittedAt: Date | null;
  approvedAt: Date | null;
  rejectionReason: string | null;
  person: { user: { name: string } };
  venture: {
    id: string;
    name: string;
    tagColor: string;
    timezone: string;
    dailyLogEditWindowHours: number;
    workingDays: number[];
  };
};

function buildView(log: LogRow, entries: TimeEntryView[], now: Date): DailyLogView {
  const businessDate = fromPrismaDate(log.businessDate);
  const totalMinutes = entries.reduce((sum, e) => sum + e.durationMinutes, 0);
  const withinWindow = isWithinEditWindow(
    businessDate,
    log.venture.timezone,
    log.venture.dailyLogEditWindowHours,
    now,
  );
  const open = log.status === "DRAFT" || log.status === "REJECTED";

  return {
    id: log.id,
    personId: log.personId,
    personName: log.person.user.name,
    ventureId: log.ventureId,
    ventureName: log.venture.name,
    ventureTagColor: log.venture.tagColor,
    businessDate,
    attendanceStatus: log.attendanceStatus,
    status: log.status,
    generalNote: log.generalNote,
    submittedAt: log.submittedAt,
    approvedAt: log.approvedAt,
    rejectionReason: log.rejectionReason,
    entries,
    totalMinutes,
    editable: open && withinWindow,
    editWindowClosesAt: new Date(
      businessDayEnd(businessDate, log.venture.timezone).getTime() +
        log.venture.dailyLogEditWindowHours * 3600 * 1000,
    ),
    attendanceConflict:
      (log.attendanceStatus === "ABSENT" || log.attendanceStatus === "ON_LEAVE") &&
      totalMinutes > 0,
  };
}

/**
 * The signed-in person's logs for one business date, one section per venture
 * they belong to (the chosen UI model).
 */
export async function getMyDay(actor: Actor, businessDate?: BusinessDate): Promise<DailyLogView[]> {
  if (!actor.personId) return [];

  const ventureIds = [...actor.memberships.keys()];
  if (ventureIds.length === 0) return [];

  const ventures = await prisma.venture.findMany({
    where: { id: { in: ventureIds }, archivedAt: null },
    select: { id: true, timezone: true },
  });

  const now = new Date();
  const out: DailyLogView[] = [];

  for (const venture of ventures) {
    const date = businessDate ?? currentBusinessDate(venture.timezone, now);

    // Create the log lazily on first view so the employee always has a row to
    // fill in; entries also create it, whichever happens first.
    const log = await prisma.dailyLog.upsert({
      where: {
        personId_ventureId_businessDate: {
          personId: actor.personId,
          ventureId: venture.id,
          businessDate: toPrismaDate(date),
        },
      },
      update: {},
      create: {
        personId: actor.personId,
        ventureId: venture.id,
        businessDate: toPrismaDate(date),
        status: "DRAFT",
        attendanceStatus: "PRESENT",
      },
      select: logSelect,
    });

    const entries = await listEntriesForDay(actor.personId, venture.id, date);
    out.push(buildView(log as LogRow, entries, now));
  }

  return out;
}

export async function getLog(actor: Actor, logId: string): Promise<DailyLogView> {
  const log = await prisma.dailyLog.findUnique({ where: { id: logId }, select: logSelect });
  if (!log) throw notFound("Daily log");

  const isOwn = log.personId === actor.personId;
  const role = actor.memberships.get(log.ventureId);
  const canReview = isSuperAdmin(actor) || role === "MANAGER";
  if (!isOwn && !canReview) throw notFound("Daily log");

  const entries = await listEntriesForDay(
    log.personId,
    log.ventureId,
    fromPrismaDate(log.businessDate),
  );
  return buildView(log as LogRow, entries, new Date());
}

/** Set attendance and note while the log is still editable (§30). */
export async function updateLog(
  actor: Actor,
  input: { logId: string; attendanceStatus?: string; generalNote?: string },
): Promise<DailyLogView> {
  const view = await getLog(actor, input.logId);
  const isOwn = view.personId === actor.personId;
  const canCorrect = isSuperAdmin(actor) || actor.memberships.get(view.ventureId) === "MANAGER";

  if (isOwn && !view.editable && !canCorrect) {
    throw new AppError(
      "EDIT_WINDOW_CLOSED",
      "The edit window for this day has closed. Ask a manager to make a correction.",
    );
  }
  if (!isOwn && !canCorrect) throw forbidden();

  const updated = await prisma.$transaction(async (tx) => {
    const after = await tx.dailyLog.update({
      where: { id: input.logId },
      data: {
        attendanceStatus: input.attendanceStatus as never,
        generalNote: input.generalNote,
      },
      select: logSelect,
    });

    // A manager changing someone else's submitted log is a correction and
    // must be audited (§29).
    if (!isOwn || view.status !== "DRAFT") {
      await writeAudit(tx, {
        actorUserId: actor.userId,
        action: "DAILY_LOG_CORRECTED",
        entityType: "DailyLog",
        entityId: input.logId,
        before: {
          attendanceStatus: view.attendanceStatus,
          generalNote: view.generalNote,
          status: view.status,
        },
        after: {
          attendanceStatus: after.attendanceStatus,
          generalNote: after.generalNote,
        },
      });
    }

    return after;
  });

  const entries = await listEntriesForDay(
    updated.personId,
    updated.ventureId,
    fromPrismaDate(updated.businessDate),
  );
  return buildView(updated as LogRow, entries, new Date());
}

/** Submit a day for review (§28). */
/**
 * Who should hear that a day was submitted: the venture's managers, plus every
 * Super Admin, since they approve anywhere.
 *
 * The submitter is excluded — a manager logging their own day does not need to
 * be told they did it.
 */
async function approverPersonIds(
  tx: PrismaTransactionClient,
  ventureId: string,
  submitterPersonId: string,
): Promise<string[]> {
  const managers = await tx.ventureMembership.findMany({
    where: { ventureId, accessRole: "MANAGER", leftAt: null },
    select: { personId: true },
  });

  const admins = await tx.person.findMany({
    where: { user: { globalRole: "SUPER_ADMIN", accountStatus: "ACTIVE" } },
    select: { id: true },
  });

  const ids = new Set([...managers.map((m) => m.personId), ...admins.map((a) => a.id)]);
  ids.delete(submitterPersonId);
  return [...ids];
}

export async function submitLog(actor: Actor, logId: string): Promise<DailyLogView> {
  const view = await getLog(actor, logId);
  if (view.personId !== actor.personId) throw forbidden("You can only submit your own log.");
  if (view.status === "SUBMITTED" || view.status === "APPROVED" || view.status === "LOCKED") {
    throw conflict("This day has already been submitted.");
  }
  if (!view.editable) {
    throw new AppError(
      "EDIT_WINDOW_CLOSED",
      "The submission window for this day has closed. Ask a manager to record it for you.",
    );
  }
  if (view.attendanceConflict) {
    throw conflict(
      "Attendance is marked as away but hours are logged. Fix the attendance or remove the hours.",
    );
  }

  const updated = await prisma.$transaction(async (tx) => {
    const after = await tx.dailyLog.update({
      where: { id: logId },
      data: { status: "SUBMITTED", submittedAt: new Date(), rejectionReason: null },
      select: logSelect,
    });
    await writeAudit(tx, {
      actorUserId: actor.userId,
      action: "DAILY_LOG_SUBMITTED",
      entityType: "DailyLog",
      entityId: logId,
      after: { totalMinutes: view.totalMinutes, attendance: view.attendanceStatus },
    });

    // Tell the people who can approve it. Without this a submitted day sits in
    // the queue with nothing to draw anyone to it, which is how work waits days
    // for an approval nobody knew was pending.
    await notifyMany(
      await approverPersonIds(tx, view.ventureId, view.personId),
      (personId) => ({
        personId,
        kind: "DAILY_LOG_SUBMITTED" as const,
        title: `${view.personName} submitted ${view.businessDate}`,
        body: `${formatMinutes(view.totalMinutes)} logged in ${view.ventureName}.`,
        link: "/approvals",
        // One alert per submitted day: re-submitting after a rejection
        // refreshes it rather than stacking a second.
        dedupeKey: `dailylog:${logId}:submitted`,
      }),
      tx,
    );

    return after;
  });

  const entries = await listEntriesForDay(
    updated.personId,
    updated.ventureId,
    fromPrismaDate(updated.businessDate),
  );
  return buildView(updated as LogRow, entries, new Date());
}

/** Approve a submitted day (§31). Approved hours are what payroll pays. */
export async function approveLog(actor: ActorWithVenture, logId: string): Promise<void> {
  const view = await getLog(actor, logId);
  if (view.ventureId !== actor.venture.id) throw notFound("Daily log");
  if (view.status !== "SUBMITTED") {
    throw conflict("Only a submitted day can be approved.");
  }
  if (view.personId === actor.personId && !isSuperAdmin(actor)) {
    throw forbidden("You cannot approve your own timesheet.");
  }

  await prisma.$transaction(async (tx) => {
    await tx.dailyLog.update({
      where: { id: logId },
      data: { status: "APPROVED", approvedAt: new Date(), approvedBy: actor.userId },
    });
    // Entries inherit approval from the log, which is the authority.
    await tx.timeEntry.updateMany({
      where: { dailyLogId: logId, approvalStatus: { not: "NEEDS_REVIEW" } },
      data: { approvalStatus: "APPROVED" },
    });

    // Close the loop: rejection already told the employee, so approval should
    // too. Otherwise the only feedback anyone receives is bad news.
    await notify(
      {
        personId: view.personId,
        kind: "DAILY_LOG_APPROVED",
        title: `Your ${view.businessDate} log was approved`,
        body: `${formatMinutes(view.totalMinutes)} approved in ${view.ventureName}.`,
        link: `/my-day?date=${view.businessDate}`,
        dedupeKey: `dailylog:${logId}:approved`,
      },
      tx,
    );
    await writeAudit(tx, {
      actorUserId: actor.userId,
      action: "DAILY_LOG_APPROVED",
      entityType: "DailyLog",
      entityId: logId,
      before: { status: "SUBMITTED" },
      after: { status: "APPROVED", totalMinutes: view.totalMinutes },
    });
  });
}

/** Reject a submitted day back to the employee, with a reason. */
export async function rejectLog(
  actor: ActorWithVenture,
  logId: string,
  reason: string,
): Promise<void> {
  const view = await getLog(actor, logId);
  if (view.ventureId !== actor.venture.id) throw notFound("Daily log");
  if (view.status !== "SUBMITTED") throw conflict("Only a submitted day can be rejected.");
  if (!reason.trim()) throw conflict("Give a reason so the employee knows what to fix.");

  await prisma.$transaction(async (tx) => {
    await tx.dailyLog.update({
      where: { id: logId },
      data: { status: "REJECTED", rejectionReason: reason.trim(), submittedAt: null },
    });
    // Let the employee know it came back, and why (§59).
    await notify(
      {
        personId: view.personId,
        kind: "DAILY_LOG_REJECTED",
        title: `Your ${view.businessDate} log was returned`,
        body: reason.trim(),
        link: `/my-day?date=${view.businessDate}`,
        dedupeKey: `dailylog:${logId}:rejected`,
      },
      tx,
    );

    await writeAudit(tx, {
      actorUserId: actor.userId,
      action: "DAILY_LOG_REJECTED",
      entityType: "DailyLog",
      entityId: logId,
      before: { status: "SUBMITTED" },
      after: { status: "REJECTED" },
      reason: reason.trim(),
    });
  });
}

/** Logs awaiting review in the ventures this actor manages (§31). */
/**
 * How many submitted days one screen shows before asking the reviewer to work
 * through them. Approvals is not paginated — a reviewer clears the queue rather
 * than browsing it — so the page reports the true total instead (§61).
 */
export const APPROVAL_QUEUE_LIMIT = 100;

/** Total submitted days awaiting this actor, so a truncated queue is visible. */
export async function countPendingApprovals(actor: Actor): Promise<number> {
  const managed = isSuperAdmin(actor)
    ? undefined
    : [...actor.memberships.entries()]
        .filter(([, role]) => role === "MANAGER")
        .map(([id]) => id);

  if (managed && managed.length === 0) return 0;

  return prisma.dailyLog.count({
    where: {
      status: "SUBMITTED",
      ...(managed ? { ventureId: { in: managed } } : {}),
    },
  });
}

export async function listPendingApprovals(actor: Actor): Promise<DailyLogView[]> {
  const managed = isSuperAdmin(actor)
    ? undefined
    : [...actor.memberships.entries()]
        .filter(([, role]) => role === "MANAGER")
        .map(([id]) => id);

  if (managed && managed.length === 0) return [];

  const logs = await prisma.dailyLog.findMany({
    where: {
      status: "SUBMITTED",
      ...(managed ? { ventureId: { in: managed } } : {}),
    },
    select: logSelect,
    // Oldest first: the queue is worked through, not browsed. Newest-first
    // would strand the days that have been waiting longest.
    orderBy: { businessDate: "asc" },
    take: APPROVAL_QUEUE_LIMIT,
  });

  if (logs.length === 0) return [];

  // One query for the whole queue rather than one per log. A hundred submitted
  // days used to mean a hundred round trips.
  const byLog = await listEntriesForLogs(logs.map((l) => l.id));

  const now = new Date();
  return logs.map((log) => buildView(log as LogRow, byLog.get(log.id) ?? [], now));
}

/**
 * People who owe a submission for a finished business day (§32).
 *
 * A day counts as missing only once the venture business day has ended, and
 * only on that venture's working days.
 */
export async function listMissingSubmissions(
  actor: Actor,
  businessDate?: BusinessDate,
): Promise<{ personId: string; personName: string; ventureId: string; ventureName: string; businessDate: BusinessDate }[]> {
  const scope = ventureIdScope(actor);
  const ventures = await prisma.venture.findMany({
    where: {
      archivedAt: null,
      ...(scope.ventureId ? { id: scope.ventureId } : {}),
    },
    select: { id: true, name: true, timezone: true, workingDays: true },
  });

  const now = new Date();
  const missing: {
    personId: string;
    personName: string;
    ventureId: string;
    ventureName: string;
    businessDate: BusinessDate;
  }[] = [];

  for (const venture of ventures) {
    const date = businessDate ?? previousBusinessDate(venture.timezone, now);
    if (!isWorkingDay(date, venture.timezone, venture.workingDays)) continue;
    // Only flag once the business day has actually ended.
    if (now < businessDayEnd(date, venture.timezone)) continue;

    const members = await prisma.ventureMembership.findMany({
      where: {
        ventureId: venture.id,
        leftAt: null,
        person: { archivedAt: null, user: { accountStatus: "ACTIVE" } },
      },
      select: { personId: true, person: { select: { user: { select: { name: true } } } } },
    });

    const submitted = await prisma.dailyLog.findMany({
      where: {
        ventureId: venture.id,
        businessDate: toPrismaDate(date),
        status: { in: ["SUBMITTED", "APPROVED", "LOCKED"] },
      },
      select: { personId: true },
    });
    const done = new Set(submitted.map((s) => s.personId));

    for (const m of members) {
      if (!done.has(m.personId)) {
        missing.push({
          personId: m.personId,
          personName: m.person.user.name,
          ventureId: venture.id,
          ventureName: venture.name,
          businessDate: date,
        });
      }
    }
  }

  return missing;
}

function previousBusinessDate(timezone: string, now: Date): BusinessDate {
  const yesterday = new Date(now.getTime() - 24 * 3600 * 1000);
  return currentBusinessDate(timezone, yesterday);
}
