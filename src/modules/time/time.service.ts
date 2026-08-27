import { prisma, type PrismaTransactionClient } from "@/lib/db/client";
import { writeAudit } from "@/lib/audit/audit";
import { AppError, conflict, forbidden, notFound } from "@/lib/errors/appError";
import { isSuperAdmin, type Actor, type ActorWithVenture } from "@/lib/permissions/types";
import {
  toBusinessDate,
  toPrismaDate,
  fromPrismaDate,
  businessDayBounds,
  type BusinessDate,
} from "@/lib/timezone/businessDate";

/**
 * Time tracking (§19-§23).
 *
 * Invariants this module enforces:
 *   - ONE active timer per person, backed by a partial unique index in the
 *     database. The service catches the violation and reports it usefully.
 *   - Duration is computed SERVER-side from the database clock. A browser
 *     never supplies a duration (§21).
 *   - business_date comes from startedAt in the VENTURE timezone; a timer
 *     spanning midnight stays one row on the start date (§22).
 *   - Every entry is linked to its DailyLog eagerly, creating the log if
 *     needed, so edit-window and lock checks always have something to consult.
 */

/** Timers longer than this are flagged for review rather than silently trusted. */
const REVIEW_THRESHOLD_HOURS = Number(process.env.TIMER_REVIEW_THRESHOLD_HOURS ?? 12);
/** The nightly job force-stops timers older than this. */
export const AUTO_STOP_HOURS = Number(process.env.TIMER_AUTO_STOP_HOURS ?? 24);

export type TimeEntryView = {
  id: string;
  taskId: string | null;
  taskTitle: string | null;
  ventureId: string;
  ventureName: string;
  personId: string;
  personName: string;
  source: string;
  startedAt: Date;
  endedAt: Date | null;
  durationSeconds: number | null;
  durationMinutes: number;
  businessDate: BusinessDate;
  note: string | null;
  approvalStatus: string;
  running: boolean;
};

const entrySelect = {
  id: true,
  taskId: true,
  ventureId: true,
  personId: true,
  source: true,
  startedAt: true,
  endedAt: true,
  durationSeconds: true,
  businessDate: true,
  note: true,
  approvalStatus: true,
  task: { select: { title: true } },
  venture: { select: { name: true } },
  person: { select: { user: { select: { name: true } } } },
} as const;

type EntryRow = {
  id: string;
  taskId: string | null;
  ventureId: string;
  personId: string;
  source: string;
  startedAt: Date;
  endedAt: Date | null;
  durationSeconds: number | null;
  businessDate: Date;
  note: string | null;
  approvalStatus: string;
  task: { title: string } | null;
  venture: { name: string };
  person: { user: { name: string } };
};

function toView(e: EntryRow): TimeEntryView {
  return {
    id: e.id,
    taskId: e.taskId,
    taskTitle: e.task?.title ?? null,
    ventureId: e.ventureId,
    ventureName: e.venture.name,
    personId: e.personId,
    personName: e.person.user.name,
    source: e.source,
    startedAt: e.startedAt,
    endedAt: e.endedAt,
    durationSeconds: e.durationSeconds,
    durationMinutes: Math.round((e.durationSeconds ?? 0) / 60),
    businessDate: fromPrismaDate(e.businessDate),
    note: e.note,
    approvalStatus: e.approvalStatus,
    running: e.endedAt === null,
  };
}

/**
 * Find or create the DailyLog that owns an entry, and refuse the write if that
 * day is already approved or locked (§26, §29).
 *
 * Called inside the caller's transaction so the log and the entry commit
 * together.
 */
async function linkDailyLog(
  tx: PrismaTransactionClient,
  args: {
    personId: string;
    ventureId: string;
    businessDate: BusinessDate;
    allowLocked: boolean;
  },
): Promise<string> {
  const businessDate = toPrismaDate(args.businessDate);

  const existing = await tx.dailyLog.findUnique({
    where: {
      personId_ventureId_businessDate: {
        personId: args.personId,
        ventureId: args.ventureId,
        businessDate,
      },
    },
    select: { id: true, status: true },
  });

  if (existing) {
    const closed = existing.status === "APPROVED" || existing.status === "LOCKED";
    if (closed && !args.allowLocked) {
      throw new AppError(
        "EDIT_WINDOW_CLOSED",
        "That day has already been approved and can no longer be changed. Ask a manager to make a correction.",
      );
    }
    return existing.id;
  }

  const created = await tx.dailyLog.create({
    data: {
      personId: args.personId,
      ventureId: args.ventureId,
      businessDate,
      status: "DRAFT",
      attendanceStatus: "PRESENT",
    },
    select: { id: true },
  });
  return created.id;
}

/** The person's currently running timer, if any. */
export async function getActiveTimer(personId: string): Promise<TimeEntryView | null> {
  const entry = await prisma.timeEntry.findFirst({
    where: { personId, endedAt: null },
    select: entrySelect,
  });
  return entry ? toView(entry as EntryRow) : null;
}

/**
 * Start a timer (§20, §21).
 *
 * The database refuses a second running timer; that violation is translated
 * into a domain error carrying the entry already running, so the UI can offer
 * to stop it.
 */
export async function startTimer(
  actor: ActorWithVenture,
  input: { taskId?: string; note?: string },
): Promise<TimeEntryView> {
  if (!actor.personId) throw forbidden("Your account has no personnel record.");

  if (input.taskId) {
    const task = await prisma.task.findUnique({
      where: { id: input.taskId },
      select: { ventureId: true, archivedAt: true },
    });
    if (!task || task.ventureId !== actor.venture.id) throw notFound("Task");
    if (task.archivedAt) throw conflict("That task has been archived.");
  }

  const startedAt = new Date();
  const businessDate = toBusinessDate(startedAt, actor.venture.timezone);

  try {
    const entry = await prisma.$transaction(async (tx) => {
      const dailyLogId = await linkDailyLog(tx, {
        personId: actor.personId!,
        ventureId: actor.venture.id,
        businessDate,
        allowLocked: false,
      });

      return tx.timeEntry.create({
        data: {
          taskId: input.taskId,
          personId: actor.personId!,
          ventureId: actor.venture.id,
          dailyLogId,
          source: "TIMER",
          startedAt,
          endedAt: null,
          businessDate: toPrismaDate(businessDate),
          note: input.note,
        },
        select: entrySelect,
      });
    });

    return toView(entry as EntryRow);
  } catch (e) {
    if (isUniqueViolation(e)) {
      const running = await getActiveTimer(actor.personId);
      throw new AppError(
        "ACTIVE_TIMER_EXISTS",
        running?.taskTitle
          ? `A timer is already running on "${running.taskTitle}". Stop it before starting another.`
          : "A timer is already running. Stop it before starting another.",
        { runningEntryId: running?.id },
      );
    }
    throw e;
  }
}

/**
 * Stop the running timer (§21).
 *
 * Duration is computed from the DATABASE clock, never the browser. A timer
 * beyond the review threshold is recorded truthfully but flagged, rather than
 * being silently truncated — the hours feed payroll and must stay honest.
 */
export async function stopTimer(actor: Actor): Promise<TimeEntryView> {
  if (!actor.personId) throw forbidden("Your account has no personnel record.");

  const running = await prisma.timeEntry.findFirst({
    where: { personId: actor.personId, endedAt: null },
    select: { id: true, startedAt: true },
  });
  if (!running) throw conflict("No timer is currently running.");

  const entry = await prisma.$transaction(async (tx) => {
    // Server time is authoritative.
    const [{ now }] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT NOW() as now`;
    const durationSeconds = Math.max(
      0,
      Math.round((now.getTime() - running.startedAt.getTime()) / 1000),
    );
    const overThreshold = durationSeconds > REVIEW_THRESHOLD_HOURS * 3600;

    return tx.timeEntry.update({
      where: { id: running.id },
      data: {
        endedAt: now,
        durationSeconds,
        approvalStatus: overThreshold ? "NEEDS_REVIEW" : "PENDING",
      },
      select: entrySelect,
    });
  });

  return toView(entry as EntryRow);
}

/**
 * Create or update a manual entry (§19, §27).
 *
 * Minutes are the input and timestamps are derived — the inverse of a timer.
 * duration_seconds remains the single source of truth for all summation.
 */
export async function saveManualEntry(
  actor: ActorWithVenture,
  input: {
    entryId?: string;
    taskId?: string;
    businessDate: BusinessDate;
    minutes: number;
    note?: string;
    personId?: string;
  },
): Promise<TimeEntryView> {
  const isManager = isSuperAdmin(actor) || actor.ventureRole === "MANAGER";
  const targetPersonId = input.personId ?? actor.personId;
  if (!targetPersonId) throw forbidden("Your account has no personnel record.");
  if (targetPersonId !== actor.personId && !isManager) {
    throw forbidden("You can only record your own time.");
  }
  if (input.minutes <= 0) throw conflict("Enter more than zero minutes.");
  if (input.minutes > 24 * 60) throw conflict("A single entry cannot exceed 24 hours.");

  if (input.taskId) {
    const task = await prisma.task.findUnique({
      where: { id: input.taskId },
      select: { ventureId: true },
    });
    if (!task || task.ventureId !== actor.venture.id) throw notFound("Task");
  }

  // Synthetic timestamps anchored to the venture-local start of day. They exist
  // to satisfy the schema shape; the minutes are what count.
  const { startUtc } = businessDayBounds(input.businessDate, actor.venture.timezone);
  const startedAt = new Date(startUtc.getTime() + 9 * 3600 * 1000); // ~09:00 local
  const endedAt = new Date(startedAt.getTime() + input.minutes * 60 * 1000);

  const entry = await prisma.$transaction(async (tx) => {
    const dailyLogId = await linkDailyLog(tx, {
      personId: targetPersonId,
      ventureId: actor.venture.id,
      businessDate: input.businessDate,
      allowLocked: isManager,
    });

    if (input.entryId) {
      const existing = await tx.timeEntry.findUnique({
        where: { id: input.entryId },
        select: { id: true, personId: true, ventureId: true, source: true, durationSeconds: true },
      });
      if (!existing) throw notFound("Time entry");
      if (existing.ventureId !== actor.venture.id) throw notFound("Time entry");
      if (existing.personId !== targetPersonId && !isManager) throw forbidden();
      if (existing.source === "TIMER" && !isManager) {
        throw forbidden("Timer entries cannot be edited here. Ask a manager for a correction.");
      }

      const updated = await tx.timeEntry.update({
        where: { id: input.entryId },
        data: {
          taskId: input.taskId ?? null,
          startedAt,
          endedAt,
          durationSeconds: input.minutes * 60,
          note: input.note,
          dailyLogId,
        },
        select: entrySelect,
      });

      if (isManager && existing.personId !== actor.personId) {
        await writeAudit(tx, {
          actorUserId: actor.userId,
          action: "TIME_ENTRY_ADJUSTED",
          entityType: "TimeEntry",
          entityId: updated.id,
          before: { durationSeconds: existing.durationSeconds },
          after: { durationSeconds: input.minutes * 60 },
        });
      }

      return updated;
    }

    return tx.timeEntry.create({
      data: {
        taskId: input.taskId,
        personId: targetPersonId,
        ventureId: actor.venture.id,
        dailyLogId,
        source: targetPersonId === actor.personId ? "MANUAL" : "ADMIN_ADJUSTMENT",
        startedAt,
        endedAt,
        durationSeconds: input.minutes * 60,
        businessDate: toPrismaDate(input.businessDate),
        note: input.note,
      },
      select: entrySelect,
    });
  });

  return toView(entry as EntryRow);
}

/** Delete a manual entry. Timer entries are never deleted by an employee. */
export async function deleteEntry(actor: ActorWithVenture, entryId: string): Promise<void> {
  const isManager = isSuperAdmin(actor) || actor.ventureRole === "MANAGER";
  const entry = await prisma.timeEntry.findUnique({
    where: { id: entryId },
    select: {
      id: true,
      personId: true,
      ventureId: true,
      source: true,
      durationSeconds: true,
      dailyLog: { select: { status: true } },
    },
  });
  if (!entry) throw notFound("Time entry");
  if (entry.ventureId !== actor.venture.id) throw notFound("Time entry");
  if (entry.personId !== actor.personId && !isManager) throw forbidden();

  const closed =
    entry.dailyLog?.status === "APPROVED" || entry.dailyLog?.status === "LOCKED";
  if (closed && !isManager) {
    throw new AppError(
      "EDIT_WINDOW_CLOSED",
      "That day has been approved and can no longer be changed.",
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.timeEntry.delete({ where: { id: entryId } });
    if (isManager && entry.personId !== actor.personId) {
      await writeAudit(tx, {
        actorUserId: actor.userId,
        action: "TIME_ENTRY_ADJUSTED",
        entityType: "TimeEntry",
        entityId: entryId,
        before: { durationSeconds: entry.durationSeconds },
        after: null,
        reason: "Entry deleted by manager",
      });
    }
  });
}

/** Entries for one person + venture + business date — the daily log breakdown. */
export async function listEntriesForDay(
  personId: string,
  ventureId: string,
  businessDate: BusinessDate,
): Promise<TimeEntryView[]> {
  const entries = await prisma.timeEntry.findMany({
    where: { personId, ventureId, businessDate: toPrismaDate(businessDate) },
    select: entrySelect,
    orderBy: { startedAt: "asc" },
  });
  return entries.map((e) => toView(e as EntryRow));
}

/** Total minutes logged by a person on a business date, across all ventures. */
export async function totalMinutesForPersonDay(
  personId: string,
  businessDate: BusinessDate,
): Promise<number> {
  const result = await prisma.timeEntry.aggregate({
    where: { personId, businessDate: toPrismaDate(businessDate) },
    _sum: { durationSeconds: true },
  });
  return Math.round((result._sum.durationSeconds ?? 0) / 60);
}

/**
 * Force-stop timers left running beyond the auto-stop threshold.
 *
 * Records the true elapsed time and flags for review — it never invents an end
 * time or discards the hours, since these feed payroll.
 */
export async function autoStopStaleTimers(): Promise<number> {
  const cutoff = new Date(Date.now() - AUTO_STOP_HOURS * 3600 * 1000);
  const stale = await prisma.timeEntry.findMany({
    where: { endedAt: null, startedAt: { lt: cutoff } },
    select: { id: true, startedAt: true },
  });

  for (const entry of stale) {
    const now = new Date();
    await prisma.timeEntry.update({
      where: { id: entry.id },
      data: {
        endedAt: now,
        durationSeconds: Math.round((now.getTime() - entry.startedAt.getTime()) / 1000),
        approvalStatus: "NEEDS_REVIEW",
        note: "Auto-stopped: timer left running. Please confirm the hours.",
      },
    });
  }

  return stale.length;
}

function isUniqueViolation(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    "code" in e &&
    (e as { code?: unknown }).code === "P2002"
  );
}
