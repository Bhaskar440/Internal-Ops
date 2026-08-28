import { prisma } from "@/lib/db/client";
import { writeAudit } from "@/lib/audit/audit";
import { conflict, forbidden, notFound } from "@/lib/errors/appError";
import { isSuperAdmin, type Actor } from "@/lib/permissions/types";
import {
  toPrismaDate,
  fromPrismaDate,
  eachBusinessDate,
  isWorkingDay,
  type BusinessDate,
} from "@/lib/timezone/businessDate";
import { agreementOn } from "@/modules/compensation/compensation.service";

/**
 * Payroll (§34, §37-§45).
 *
 * Portfolio Ops calculates GROSS PAYABLE AMOUNT ONLY. It does not move money,
 * compute tax, or file anything (§34).
 *
 * Two rules shape this module:
 *   - A PayrollLine stores every value used in its own calculation (§42), so a
 *     later rate change cannot alter a historical run.
 *   - Hourly pay uses APPROVED hours only (§31). Draft hours never pay.
 */

function assertPayrollAccess(actor: Actor): void {
  if (!isSuperAdmin(actor)) throw forbidden("You are not authorized to view payroll.");
}

export type PayrollException = {
  personId: string;
  personName: string;
  type: string;
  detail: string;
};

export type PayrollLineView = {
  id: string;
  personId: string;
  personName: string;
  payType: string;
  currency: string;
  rate: string;
  approvedMinutes: number;
  eligibleDays: number | null;
  workingDays: number | null;
  computedPay: string;
  paymentStatus: string;
  paidAt: Date | null;
};

export type PayrollRunView = {
  id: string;
  periodStart: BusinessDate;
  periodEnd: BusinessDate;
  status: string;
  generatedAt: Date | null;
  lockedAt: Date | null;
  notes: string | null;
  lines: PayrollLineView[];
  /** Totals per currency — never summed across currencies (§36). */
  totalsByCurrency: { currency: string; total: string; lineCount: number }[];
};

/** Calendar month period for a given year and month (1-12). */
export function monthPeriod(year: number, month: number): { start: BusinessDate; end: BusinessDate } {
  const pad = (n: number) => String(n).padStart(2, "0");
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    start: `${year}-${pad(month)}-01`,
    end: `${year}-${pad(month)}-${pad(lastDay)}`,
  };
}

/** Create a draft run for a period. */
export async function createRun(
  actor: Actor,
  input: { periodStart: BusinessDate; periodEnd: BusinessDate; notes?: string },
) {
  assertPayrollAccess(actor);
  if (input.periodStart > input.periodEnd) {
    throw conflict("The period start must be on or before the period end.");
  }

  const existing = await prisma.payrollRun.findFirst({
    where: {
      periodStart: toPrismaDate(input.periodStart),
      periodEnd: toPrismaDate(input.periodEnd),
      status: { notIn: ["VOID"] },
    },
    select: { id: true },
  });
  if (existing) throw conflict("A payroll run already exists for that period.");

  return prisma.$transaction(async (tx) => {
    const run = await tx.payrollRun.create({
      data: {
        periodStart: toPrismaDate(input.periodStart),
        periodEnd: toPrismaDate(input.periodEnd),
        status: "DRAFT",
        notes: input.notes,
      },
      select: { id: true, periodStart: true, periodEnd: true, status: true },
    });

    await writeAudit(tx, {
      actorUserId: actor.userId,
      action: "PAYROLL_GENERATED",
      entityType: "PayrollRun",
      entityId: run.id,
      after: { periodStart: input.periodStart, periodEnd: input.periodEnd, status: "DRAFT" },
      reason: "Draft run created",
    });

    return run;
  });
}

/**
 * Checks that must be resolved before a run can be locked (§44).
 * Returns identity and problem type only — never a rate.
 */
export async function findExceptions(
  actor: Actor,
  runId: string,
): Promise<PayrollException[]> {
  assertPayrollAccess(actor);

  const run = await prisma.payrollRun.findUnique({
    where: { id: runId },
    select: { periodStart: true, periodEnd: true },
  });
  if (!run) throw notFound("Payroll run");

  const from = run.periodStart;
  const to = run.periodEnd;
  const periodEndLabel = fromPrismaDate(to);

  const people = await prisma.person.findMany({
    where: { archivedAt: null, user: { accountStatus: "ACTIVE" } },
    select: {
      id: true,
      endDate: true,
      user: { select: { name: true, accountStatus: true } },
    },
  });

  const exceptions: PayrollException[] = [];

  for (const person of people) {
    // Missing or incomplete compensation.
    const agreement = await agreementOn(person.id, periodEndLabel);
    if (!agreement) {
      exceptions.push({
        personId: person.id,
        personName: person.user.name,
        type: "MISSING_PAY_RATE",
        detail: "No compensation agreement covers this period.",
      });
      continue;
    }
    if (!agreement.currency) {
      exceptions.push({
        personId: person.id,
        personName: person.user.name,
        type: "MISSING_CURRENCY",
        detail: "The compensation agreement has no currency.",
      });
    }

    // Time submitted but never approved — would not be paid (§31).
    const unapproved = await prisma.timeEntry.count({
      where: {
        personId: person.id,
        businessDate: { gte: from, lte: to },
        durationSeconds: { not: null },
        dailyLog: { status: { in: ["DRAFT", "SUBMITTED", "REJECTED"] } },
      },
    });
    if (unapproved > 0) {
      exceptions.push({
        personId: person.id,
        personName: person.user.name,
        type: "UNAPPROVED_HOURS",
        detail: `${unapproved} time entr${unapproved === 1 ? "y" : "ies"} not yet approved.`,
      });
    }

    // Entries flagged during timing, e.g. a timer left running.
    const flagged = await prisma.timeEntry.count({
      where: {
        personId: person.id,
        businessDate: { gte: from, lte: to },
        approvalStatus: "NEEDS_REVIEW",
      },
    });
    if (flagged > 0) {
      exceptions.push({
        personId: person.id,
        personName: person.user.name,
        type: "NEEDS_REVIEW",
        detail: `${flagged} entr${flagged === 1 ? "y" : "ies"} flagged for review.`,
      });
    }

    // Attendance says away but hours exist (§30).
    const conflicting = await prisma.dailyLog.count({
      where: {
        personId: person.id,
        businessDate: { gte: from, lte: to },
        attendanceStatus: { in: ["ABSENT", "ON_LEAVE"] },
        timeEntries: { some: { durationSeconds: { gt: 0 } } },
      },
    });
    if (conflicting > 0) {
      exceptions.push({
        personId: person.id,
        personName: person.user.name,
        type: "CONFLICTING_ATTENDANCE",
        detail: `${conflicting} day(s) marked away but with hours logged.`,
      });
    }

    // Person left partway through the period.
    if (person.endDate && person.endDate < to) {
      exceptions.push({
        personId: person.id,
        personName: person.user.name,
        type: "PERSON_INACTIVE",
        detail: `Left on ${fromPrismaDate(person.endDate)}, before the period ended.`,
      });
    }
  }

  return exceptions;
}

/**
 * Calculate the run and write its lines (§37, §38, §39, §42).
 *
 * Everything used in the calculation is copied onto the line, so the run is a
 * snapshot rather than a live view.
 */
export async function generateLines(actor: Actor, runId: string) {
  assertPayrollAccess(actor);

  const run = await prisma.payrollRun.findUnique({
    where: { id: runId },
    select: { id: true, periodStart: true, periodEnd: true, status: true },
  });
  if (!run) throw notFound("Payroll run");
  if (run.status === "LOCKED" || run.status === "PAID") {
    throw conflict("This run is locked and can no longer be recalculated.");
  }

  const startLabel = fromPrismaDate(run.periodStart);
  const endLabel = fromPrismaDate(run.periodEnd);

  const people = await prisma.person.findMany({
    where: { archivedAt: null, user: { accountStatus: "ACTIVE" } },
    select: {
      id: true,
      memberships: {
        where: { leftAt: null },
        select: { venture: { select: { timezone: true, workingDays: true } } },
      },
    },
  });

  await prisma.$transaction(async (tx) => {
    // Recalculating replaces the previous draft lines entirely.
    await tx.payrollLine.deleteMany({ where: { payrollRunId: runId } });

    for (const person of people) {
      const agreement = await agreementOn(person.id, endLabel);
      if (!agreement) continue; // surfaced as an exception, not paid silently

      // APPROVED hours only — draft hours never pay (§31).
      const approved = await tx.timeEntry.aggregate({
        where: {
          personId: person.id,
          businessDate: { gte: run.periodStart, lte: run.periodEnd },
          durationSeconds: { not: null },
          dailyLog: { status: { in: ["APPROVED", "LOCKED"] } },
        },
        _sum: { durationSeconds: true },
      });
      const approvedMinutes = Math.round((approved._sum.durationSeconds ?? 0) / 60);

      // Attendance days actually worked, for the prorated monthly policy.
      const eligible = await tx.dailyLog.count({
        where: {
          personId: person.id,
          businessDate: { gte: run.periodStart, lte: run.periodEnd },
          status: { in: ["APPROVED", "LOCKED"] },
          attendanceStatus: { in: ["PRESENT", "REMOTE"] },
        },
      });

      // Working days in the period, from the person's primary venture calendar.
      const calendar = person.memberships[0]?.venture;
      const workingDays = calendar
        ? eachBusinessDate(startLabel, endLabel).filter((d) =>
            isWorkingDay(d, calendar.timezone, calendar.workingDays),
          ).length
        : 0;

      const rate = Number(agreement.rate);
      let computedPay = 0;

      if (agreement.payType === "HOURLY") {
        // §37: approved payable hours * effective hourly rate.
        computedPay = (approvedMinutes / 60) * rate;
      } else if (agreement.payType === "MONTHLY_FIXED") {
        if (agreement.prorationPolicy === "ATTENDANCE_PRORATED" && workingDays > 0) {
          // §38 Option B.
          computedPay = rate * (eligible / workingDays);
        } else {
          // §38 Option A — the chosen default.
          computedPay = rate;
        }
      } else if (agreement.payType === "PER_TASK") {
        // §39: fixed fees on tasks completed within the period.
        const tasks = await tx.task.findMany({
          where: {
            status: "DONE",
            archivedAt: null,
            fixedFee: { not: null },
            completedAt: { gte: run.periodStart, lte: endOfDay(run.periodEnd) },
            assignees: { some: { personId: person.id } },
          },
          select: { fixedFee: true, feeCurrency: true },
        });
        computedPay = tasks
          .filter((t) => (t.feeCurrency ?? agreement.currency) === agreement.currency)
          .reduce((sum, t) => sum + Number(t.fixedFee ?? 0), 0);
      }

      // Outstanding adjustments from earlier PAID runs settle forward into this
      // one (§43). Only matching-currency adjustments are applied, since mixed
      // currencies are never combined (§36).
      const outstanding = await tx.payrollAdjustment.findMany({
        where: {
          personId: person.id,
          settledPayrollLineId: null,
          currency: agreement.currency,
        },
        select: { id: true, amount: true },
      });
      const adjustmentTotal = outstanding.reduce((sum, a) => sum + Number(a.amount), 0);

      // Nothing earned, nothing worked and nothing to settle — no zero line.
      if (computedPay === 0 && approvedMinutes === 0 && outstanding.length === 0) continue;

      const line = await tx.payrollLine.create({
        data: {
          payrollRunId: runId,
          personId: person.id,
          payTypeSnapshot: agreement.payType,
          currency: agreement.currency,
          rateSnapshot: agreement.rate,
          approvedMinutes,
          eligibleDays: eligible,
          workingDays,
          // The adjustment is folded into the payable amount, so the line still
          // states exactly what this person is owed for this run.
          computedPay: (computedPay + adjustmentTotal).toFixed(4),
          paymentStatus: "UNPAID",
        },
        select: { id: true },
      });

      if (outstanding.length > 0) {
        await tx.payrollAdjustment.updateMany({
          where: { id: { in: outstanding.map((a) => a.id) } },
          data: { settledPayrollLineId: line.id },
        });
      }
    }

    await tx.payrollRun.update({
      where: { id: runId },
      data: { status: "REVIEW", generatedAt: new Date(), generatedBy: actor.userId },
    });

    await writeAudit(tx, {
      actorUserId: actor.userId,
      action: "PAYROLL_GENERATED",
      entityType: "PayrollRun",
      entityId: runId,
      after: { status: "REVIEW", periodStart: startLabel, periodEnd: endLabel },
    });
  });
}

/** Lock the run, freezing the snapshot (§40, §42). */
export async function lockRun(actor: Actor, runId: string) {
  assertPayrollAccess(actor);

  const run = await prisma.payrollRun.findUnique({
    where: { id: runId },
    select: { id: true, status: true, _count: { select: { lines: true } } },
  });
  if (!run) throw notFound("Payroll run");
  if (run.status === "LOCKED" || run.status === "PAID") {
    throw conflict("This run is already locked.");
  }
  if (run._count.lines === 0) {
    throw conflict("Generate the payroll lines before locking the run.");
  }

  await prisma.$transaction(async (tx) => {
    await tx.payrollRun.update({
      where: { id: runId },
      data: { status: "LOCKED", lockedAt: new Date(), lockedBy: actor.userId },
    });

    // Approved days in this period become LOCKED so they can no longer change.
    const period = await tx.payrollRun.findUniqueOrThrow({
      where: { id: runId },
      select: { periodStart: true, periodEnd: true },
    });
    await tx.dailyLog.updateMany({
      where: {
        businessDate: { gte: period.periodStart, lte: period.periodEnd },
        status: "APPROVED",
      },
      data: { status: "LOCKED", lockedAt: new Date() },
    });

    await writeAudit(tx, {
      actorUserId: actor.userId,
      action: "PAYROLL_LOCKED",
      entityType: "PayrollRun",
      entityId: runId,
      before: { status: run.status },
      after: { status: "LOCKED", lineCount: run._count.lines },
    });
  });
}

/** Void an unpaid run, with a mandatory reason (§43). */
export async function voidRun(actor: Actor, runId: string, reason: string) {
  assertPayrollAccess(actor);
  if (!reason.trim()) throw conflict("A reason is required to void a payroll run.");

  const run = await prisma.payrollRun.findUnique({
    where: { id: runId },
    select: { id: true, status: true, lines: { select: { paymentStatus: true } } },
  });
  if (!run) throw notFound("Payroll run");
  if (run.lines.some((l) => l.paymentStatus === "PAID")) {
    throw conflict(
      "Some lines in this run are already paid. Paid payroll is never rewritten — create an adjustment instead.",
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.payrollRun.update({
      where: { id: runId },
      data: { status: "VOID", voidReason: reason.trim() },
    });
    await writeAudit(tx, {
      actorUserId: actor.userId,
      action: "PAYROLL_VOIDED",
      entityType: "PayrollRun",
      entityId: runId,
      before: { status: run.status },
      after: { status: "VOID" },
      reason: reason.trim(),
    });
  });
}

/** Mark one line paid after the external system has actually paid it (§45). */
export async function markLinePaid(
  actor: Actor,
  lineId: string,
  paymentReference?: string,
) {
  assertPayrollAccess(actor);

  const line = await prisma.payrollLine.findUnique({
    where: { id: lineId },
    select: {
      id: true,
      paymentStatus: true,
      payrollRunId: true,
      run: { select: { status: true } },
    },
  });
  if (!line) throw notFound("Payroll line");
  if (line.paymentStatus === "PAID") throw conflict("That line is already marked paid.");
  if (line.run.status !== "LOCKED" && line.run.status !== "PAID") {
    throw conflict("Lock the payroll run before marking anything paid.");
  }

  await prisma.$transaction(async (tx) => {
    await tx.payrollLine.update({
      where: { id: lineId },
      data: {
        paymentStatus: "PAID",
        paidAt: new Date(),
        paidBy: actor.userId,
        paymentReference,
      },
    });

    // When every line is paid, the run itself is paid.
    const remaining = await tx.payrollLine.count({
      where: { payrollRunId: line.payrollRunId, paymentStatus: "UNPAID" },
    });
    if (remaining === 0) {
      await tx.payrollRun.update({
        where: { id: line.payrollRunId },
        data: { status: "PAID" },
      });
    }

    await writeAudit(tx, {
      actorUserId: actor.userId,
      action: "PAYROLL_MARKED_PAID",
      entityType: "PayrollLine",
      entityId: lineId,
      after: { paymentStatus: "PAID", paymentReference },
    });
  });
}

/** One run with its lines and per-currency totals. */
export async function getRun(actor: Actor, runId: string): Promise<PayrollRunView> {
  assertPayrollAccess(actor);

  const run = await prisma.payrollRun.findUnique({
    where: { id: runId },
    select: {
      id: true,
      periodStart: true,
      periodEnd: true,
      status: true,
      generatedAt: true,
      lockedAt: true,
      notes: true,
      lines: {
        select: {
          id: true,
          personId: true,
          payTypeSnapshot: true,
          currency: true,
          rateSnapshot: true,
          approvedMinutes: true,
          eligibleDays: true,
          workingDays: true,
          computedPay: true,
          paymentStatus: true,
          paidAt: true,
          person: { select: { user: { select: { name: true } } } },
        },
        orderBy: { person: { user: { name: "asc" } } },
      },
    },
  });
  if (!run) throw notFound("Payroll run");

  const lines: PayrollLineView[] = run.lines.map((l) => ({
    id: l.id,
    personId: l.personId,
    personName: l.person.user.name,
    payType: l.payTypeSnapshot,
    currency: l.currency,
    rate: String(l.rateSnapshot),
    approvedMinutes: l.approvedMinutes,
    eligibleDays: l.eligibleDays,
    workingDays: l.workingDays,
    computedPay: String(l.computedPay),
    paymentStatus: l.paymentStatus,
    paidAt: l.paidAt,
  }));

  // Totals are kept per currency; mixed currencies are never added (§36).
  const byCurrency = new Map<string, { total: number; count: number }>();
  for (const l of lines) {
    const acc = byCurrency.get(l.currency) ?? { total: 0, count: 0 };
    acc.total += Number(l.computedPay);
    acc.count += 1;
    byCurrency.set(l.currency, acc);
  }

  return {
    id: run.id,
    periodStart: fromPrismaDate(run.periodStart),
    periodEnd: fromPrismaDate(run.periodEnd),
    status: run.status,
    generatedAt: run.generatedAt,
    lockedAt: run.lockedAt,
    notes: run.notes,
    lines,
    totalsByCurrency: [...byCurrency.entries()].map(([currency, v]) => ({
      currency,
      total: v.total.toFixed(2),
      lineCount: v.count,
    })),
  };
}

export async function listRuns(actor: Actor) {
  assertPayrollAccess(actor);
  const runs = await prisma.payrollRun.findMany({
    orderBy: { periodStart: "desc" },
    take: 50,
    select: {
      id: true,
      periodStart: true,
      periodEnd: true,
      status: true,
      lockedAt: true,
      _count: { select: { lines: true } },
    },
  });
  return runs.map((r) => ({
    id: r.id,
    periodStart: fromPrismaDate(r.periodStart),
    periodEnd: fromPrismaDate(r.periodEnd),
    status: r.status,
    lockedAt: r.lockedAt,
    lineCount: r._count.lines,
  }));
}

// --- adjustments (§43) ------------------------------------------------------

export type AdjustmentView = {
  id: string;
  personId: string;
  personName: string;
  amount: string;
  currency: string;
  reason: string;
  createdAt: Date;
  settled: boolean;
  settledAt: Date | null;
  sourcePeriod: string | null;
};

/**
 * Raise a correction against payroll that has ALREADY BEEN PAID.
 *
 * Paid payroll is never rewritten (§43). Instead the difference is recorded
 * here and settles forward into the person's next run, so the historical
 * snapshot and the audit trail both stay intact.
 *
 * A positive amount pays more; a negative amount recovers an overpayment.
 */
export async function createAdjustment(
  actor: Actor,
  input: {
    personId: string;
    sourcePayrollLineId?: string;
    amount: number;
    currency: string;
    reason: string;
  },
) {
  assertPayrollAccess(actor);

  if (!Number.isFinite(input.amount) || input.amount === 0) {
    throw conflict("Enter an amount other than zero.");
  }
  if (!input.reason.trim()) {
    throw conflict("A reason is required so the correction can be explained later.");
  }

  const person = await prisma.person.findUnique({
    where: { id: input.personId },
    select: { id: true },
  });
  if (!person) throw notFound("Person");

  // When raised against a specific line, that line must actually be paid —
  // an unpaid run should be voided and regenerated instead (§43).
  if (input.sourcePayrollLineId) {
    const source = await prisma.payrollLine.findUnique({
      where: { id: input.sourcePayrollLineId },
      select: { id: true, personId: true, paymentStatus: true, currency: true },
    });
    if (!source) throw notFound("Payroll line");
    if (source.personId !== input.personId) {
      throw conflict("That payroll line belongs to a different person.");
    }
    if (source.paymentStatus !== "PAID") {
      throw conflict(
        "That line has not been paid yet. Void the run and regenerate it instead of adjusting.",
      );
    }
    if (source.currency !== input.currency.toUpperCase()) {
      throw conflict("The adjustment currency must match the original payroll line.");
    }
  }

  return prisma.$transaction(async (tx) => {
    const created = await tx.payrollAdjustment.create({
      data: {
        personId: input.personId,
        sourcePayrollLineId: input.sourcePayrollLineId,
        amount: input.amount,
        currency: input.currency.toUpperCase(),
        reason: input.reason.trim(),
        createdBy: actor.userId,
      },
      select: { id: true, amount: true, currency: true },
    });

    await writeAudit(tx, {
      actorUserId: actor.userId,
      action: "PAYROLL_ADJUSTED",
      entityType: "PayrollAdjustment",
      entityId: created.id,
      after: {
        personId: input.personId,
        amount: input.amount,
        currency: created.currency,
        sourcePayrollLineId: input.sourcePayrollLineId ?? null,
      },
      reason: input.reason.trim(),
    });

    return created;
  });
}

/** Adjustments, newest first. Outstanding ones settle into the next run. */
export async function listAdjustments(
  actor: Actor,
  opts: { personId?: string; outstandingOnly?: boolean } = {},
): Promise<AdjustmentView[]> {
  assertPayrollAccess(actor);

  const rows = await prisma.payrollAdjustment.findMany({
    where: {
      ...(opts.personId ? { personId: opts.personId } : {}),
      ...(opts.outstandingOnly ? { settledPayrollLineId: null } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true,
      personId: true,
      amount: true,
      currency: true,
      reason: true,
      createdAt: true,
      settledPayrollLineId: true,
      person: { select: { user: { select: { name: true } } } },
      settledLine: { select: { run: { select: { periodStart: true, periodEnd: true } } } },
      sourceLine: { select: { run: { select: { periodStart: true, periodEnd: true } } } },
    },
  });

  return rows.map((r) => ({
    id: r.id,
    personId: r.personId,
    personName: r.person.user.name,
    amount: String(r.amount),
    currency: r.currency,
    reason: r.reason,
    createdAt: r.createdAt,
    settled: r.settledPayrollLineId !== null,
    settledAt: r.settledLine ? r.settledLine.run.periodEnd : null,
    sourcePeriod: r.sourceLine
      ? `${fromPrismaDate(r.sourceLine.run.periodStart)} → ${fromPrismaDate(r.sourceLine.run.periodEnd)}`
      : null,
  }));
}

/**
 * Cancel an adjustment that has not settled yet.
 *
 * A settled adjustment is part of a paid line and can never be removed — that
 * would rewrite history, which is exactly what §43 forbids.
 */
export async function cancelAdjustment(actor: Actor, adjustmentId: string, reason: string) {
  assertPayrollAccess(actor);
  if (!reason.trim()) throw conflict("A reason is required to cancel an adjustment.");

  const existing = await prisma.payrollAdjustment.findUnique({
    where: { id: adjustmentId },
    select: { id: true, amount: true, currency: true, settledPayrollLineId: true },
  });
  if (!existing) throw notFound("Adjustment");
  if (existing.settledPayrollLineId) {
    throw conflict(
      "That adjustment has already been settled into a payroll run and cannot be removed.",
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.payrollAdjustment.delete({ where: { id: adjustmentId } });
    await writeAudit(tx, {
      actorUserId: actor.userId,
      action: "PAYROLL_ADJUSTED",
      entityType: "PayrollAdjustment",
      entityId: adjustmentId,
      before: { amount: existing.amount, currency: existing.currency },
      after: null,
      reason: `Cancelled: ${reason.trim()}`,
    });
  });
}

function endOfDay(d: Date): Date {
  const out = new Date(d);
  out.setUTCHours(23, 59, 59, 999);
  return out;
}
