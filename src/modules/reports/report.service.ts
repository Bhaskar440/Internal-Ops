import { prisma } from "@/lib/db/client";
import { ventureIdScope } from "@/lib/permissions/scopes";
import { isSuperAdmin, type Actor } from "@/lib/permissions/types";
import { aggregateEfficiency, calculateEfficiency } from "@/lib/money/efficiency";
import {
  toPrismaDate,
  countWorkingDays,
  type BusinessDate,
} from "@/lib/timezone/businessDate";

/**
 * Reporting (§33).
 *
 * Aggregate efficiency is always SUM(estimated) / SUM(actual) — never the mean
 * of per-task percentages (§25), so a five-minute task cannot outweigh a
 * forty-hour one.
 */

export type ReportFilters = {
  from?: BusinessDate;
  to?: BusinessDate;
  ventureId?: string;
  personId?: string;
  employmentType?: string;
  /** Only count hours a manager has approved — what payroll would pay. */
  approvedOnly?: boolean;
};

/** Resolve the venture ids this actor may report on, honouring any filter. */
function resolveVentureIds(actor: Actor, ventureId?: string): string[] | undefined | null {
  const scope = ventureIdScope(actor);
  const allowed = scope.ventureId?.in;

  if (!ventureId) return allowed;
  if (!allowed) return [ventureId];
  return allowed.includes(ventureId) ? [ventureId] : null; // null = no access
}

function dateFilter(from?: BusinessDate, to?: BusinessDate) {
  if (!from && !to) return {};
  return {
    businessDate: {
      ...(from ? { gte: toPrismaDate(from) } : {}),
      ...(to ? { lte: toPrismaDate(to) } : {}),
    },
  };
}

export type HoursRow = {
  personId: string;
  personName: string;
  ventureId: string;
  ventureName: string;
  minutes: number;
  approvedMinutes: number;
};

/** Hours per person per venture (§33 Hours Report). */
export async function hoursReport(
  actor: Actor,
  filters: ReportFilters = {},
): Promise<HoursRow[]> {
  const ventureIds = resolveVentureIds(actor, filters.ventureId);
  if (ventureIds === null) return [];

  const entries = await prisma.timeEntry.findMany({
    where: {
      ...(ventureIds ? { ventureId: { in: ventureIds } } : {}),
      ...(filters.personId ? { personId: filters.personId } : {}),
      ...dateFilter(filters.from, filters.to),
      durationSeconds: { not: null },
      ...(filters.employmentType
        ? { person: { employmentType: filters.employmentType as never } }
        : {}),
    },
    select: {
      personId: true,
      ventureId: true,
      durationSeconds: true,
      approvalStatus: true,
      person: { select: { user: { select: { name: true } } } },
      venture: { select: { name: true } },
      dailyLog: { select: { status: true } },
    },
  });

  const map = new Map<string, HoursRow>();
  for (const e of entries) {
    const key = `${e.personId}:${e.ventureId}`;
    const row = map.get(key) ?? {
      personId: e.personId,
      personName: e.person.user.name,
      ventureId: e.ventureId,
      ventureName: e.venture.name,
      minutes: 0,
      approvedMinutes: 0,
    };
    const minutes = Math.round((e.durationSeconds ?? 0) / 60);
    row.minutes += minutes;

    // The daily log is the authority on approval (§31).
    const approved =
      e.dailyLog?.status === "APPROVED" || e.dailyLog?.status === "LOCKED";
    if (approved) row.approvedMinutes += minutes;

    map.set(key, row);
  }

  return [...map.values()].sort((a, b) => a.personName.localeCompare(b.personName));
}

export type VenturePerformanceRow = {
  ventureId: string;
  ventureName: string;
  tagColor: string;
  tasksCompleted: number;
  tasksOpen: number;
  tasksOverdue: number;
  estimatedMinutes: number;
  actualMinutes: number;
  efficiency: number | null;
  overduePercent: number;
};

/** Venture performance (§33). Efficiency uses completed tasks only (§25). */
export async function venturePerformance(
  actor: Actor,
  filters: ReportFilters = {},
): Promise<VenturePerformanceRow[]> {
  const ventureIds = resolveVentureIds(actor, filters.ventureId);
  if (ventureIds === null) return [];

  const ventures = await prisma.venture.findMany({
    where: { archivedAt: null, ...(ventureIds ? { id: { in: ventureIds } } : {}) },
    select: { id: true, name: true, tagColor: true },
    orderBy: { name: "asc" },
  });

  const rows: VenturePerformanceRow[] = [];
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  for (const venture of ventures) {
    const tasks = await prisma.task.findMany({
      where: { ventureId: venture.id, archivedAt: null },
      select: { id: true, status: true, estimatedMinutes: true, dueDate: true },
    });

    const completed = tasks.filter((t) => t.status === "DONE");
    const open = tasks.filter((t) => t.status !== "DONE");
    const overdue = open.filter((t) => t.dueDate && t.dueDate < today);

    const actuals = await prisma.timeEntry.groupBy({
      by: ["taskId"],
      where: {
        taskId: { in: completed.map((t) => t.id) },
        durationSeconds: { not: null },
      },
      _sum: { durationSeconds: true },
    });
    const actualByTask = new Map(
      actuals.map((a) => [a.taskId, Math.round((a._sum.durationSeconds ?? 0) / 60)]),
    );

    const pairs = completed.map((t) => ({
      estimatedMinutes: t.estimatedMinutes,
      actualMinutes: actualByTask.get(t.id) ?? 0,
    }));

    rows.push({
      ventureId: venture.id,
      ventureName: venture.name,
      tagColor: venture.tagColor,
      tasksCompleted: completed.length,
      tasksOpen: open.length,
      tasksOverdue: overdue.length,
      estimatedMinutes: pairs.reduce((s, p) => s + p.estimatedMinutes, 0),
      actualMinutes: pairs.reduce((s, p) => s + p.actualMinutes, 0),
      efficiency: aggregateEfficiency(pairs),
      overduePercent: open.length === 0 ? 0 : (overdue.length / open.length) * 100,
    });
  }

  return rows;
}

export type PersonPerformanceRow = {
  personId: string;
  personName: string;
  employmentType: string;
  tasksCompleted: number;
  estimatedMinutes: number;
  actualMinutes: number;
  efficiency: number | null;
  daysPresent: number;
  daysRemote: number;
  daysLeave: number;
  daysAbsent: number;
  /** Days actually worked — present plus remote. */
  daysWorked: number;
  /**
   * Working days in the reported range, from the venture calendar. Null when
   * no range was given, since "out of how many" has no meaning then.
   */
  workingDaysInPeriod: number | null;
  attendancePercent: number | null;
};

/** Person performance (§33). */
export async function personPerformance(
  actor: Actor,
  filters: ReportFilters = {},
): Promise<PersonPerformanceRow[]> {
  const ventureIds = resolveVentureIds(actor, filters.ventureId);
  if (ventureIds === null) return [];

  const people = await prisma.person.findMany({
    where: {
      archivedAt: null,
      ...(filters.personId ? { id: filters.personId } : {}),
      ...(filters.employmentType ? { employmentType: filters.employmentType as never } : {}),
      ...(ventureIds
        ? { memberships: { some: { ventureId: { in: ventureIds }, leftAt: null } } }
        : {}),
    },
    select: {
      id: true,
      employmentType: true,
      user: { select: { name: true } },
    },
    orderBy: { user: { name: "asc" } },
  });

  const rows: PersonPerformanceRow[] = [];

  for (const person of people) {
    const assigned = await prisma.taskAssignee.findMany({
      where: {
        personId: person.id,
        task: {
          status: "DONE",
          archivedAt: null,
          ...(ventureIds ? { ventureId: { in: ventureIds } } : {}),
        },
      },
      select: { task: { select: { id: true, estimatedMinutes: true } } },
    });

    const actuals = await prisma.timeEntry.groupBy({
      by: ["taskId"],
      where: {
        taskId: { in: assigned.map((a) => a.task.id) },
        durationSeconds: { not: null },
      },
      _sum: { durationSeconds: true },
    });
    const actualByTask = new Map(
      actuals.map((a) => [a.taskId, Math.round((a._sum.durationSeconds ?? 0) / 60)]),
    );

    const pairs = assigned.map((a) => ({
      estimatedMinutes: a.task.estimatedMinutes,
      actualMinutes: actualByTask.get(a.task.id) ?? 0,
    }));

    const logs = await prisma.dailyLog.groupBy({
      by: ["attendanceStatus"],
      where: {
        personId: person.id,
        ...(ventureIds ? { ventureId: { in: ventureIds } } : {}),
        ...dateFilter(filters.from, filters.to),
        status: { in: ["SUBMITTED", "APPROVED", "LOCKED"] },
      },
      _count: true,
    });

    const count = (status: string) =>
      logs.find((l) => l.attendanceStatus === status)?._count ?? 0;

    const present = count("PRESENT");
    const remote = count("REMOTE");
    const leave = count("ON_LEAVE");
    const absent = count("ABSENT");
    const daysWorked = present + remote;

    // Working days come from the venture calendar, not from how many days the
    // person happened to submit. Dividing by submissions would show 100% for
    // someone who submitted five days out of twenty-one.
    let workingDaysInPeriod: number | null = null;
    if (filters.from && filters.to) {
      const calendar = await prisma.venture.findFirst({
        where: {
          archivedAt: null,
          ...(ventureIds ? { id: { in: ventureIds } } : {}),
          memberships: { some: { personId: person.id, leftAt: null } },
        },
        select: { timezone: true, workingDays: true },
      });
      if (calendar) {
        workingDaysInPeriod = countWorkingDays(
          filters.from,
          filters.to,
          calendar.timezone,
          calendar.workingDays,
        );
      }
    }

    // Percentage of the working days in the period, falling back to submitted
    // days when no range was given.
    const denominator = workingDaysInPeriod ?? present + remote + leave + absent;

    rows.push({
      personId: person.id,
      personName: person.user.name,
      employmentType: person.employmentType,
      tasksCompleted: assigned.length,
      estimatedMinutes: pairs.reduce((s, p) => s + p.estimatedMinutes, 0),
      actualMinutes: pairs.reduce((s, p) => s + p.actualMinutes, 0),
      efficiency: aggregateEfficiency(pairs),
      daysPresent: present,
      daysRemote: remote,
      daysLeave: leave,
      daysAbsent: absent,
      daysWorked,
      workingDaysInPeriod,
      attendancePercent: denominator === 0 ? null : (daysWorked / denominator) * 100,
    });
  }

  return rows;
}

export type TaskEfficiencyRow = {
  taskId: string;
  title: string;
  ventureName: string;
  status: string;
  estimatedMinutes: number;
  actualMinutes: number;
  varianceMinutes: number;
  efficiency: number | null;
};

/** Per-task estimate vs actual, for drilling into where estimates slip. */
export async function taskEfficiencyReport(
  actor: Actor,
  filters: ReportFilters = {},
): Promise<TaskEfficiencyRow[]> {
  const ventureIds = resolveVentureIds(actor, filters.ventureId);
  if (ventureIds === null) return [];

  const tasks = await prisma.task.findMany({
    where: {
      archivedAt: null,
      ...(ventureIds ? { ventureId: { in: ventureIds } } : {}),
      ...(filters.personId ? { assignees: { some: { personId: filters.personId } } } : {}),
    },
    select: {
      id: true,
      title: true,
      status: true,
      estimatedMinutes: true,
      venture: { select: { name: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 500,
  });

  const actuals = await prisma.timeEntry.groupBy({
    by: ["taskId"],
    where: { taskId: { in: tasks.map((t) => t.id) }, durationSeconds: { not: null } },
    _sum: { durationSeconds: true },
  });
  const actualByTask = new Map(
    actuals.map((a) => [a.taskId, Math.round((a._sum.durationSeconds ?? 0) / 60)]),
  );

  return tasks.map((t) => {
    const actualMinutes = actualByTask.get(t.id) ?? 0;
    return {
      taskId: t.id,
      title: t.title,
      ventureName: t.venture.name,
      status: t.status,
      estimatedMinutes: t.estimatedMinutes,
      actualMinutes,
      varianceMinutes: actualMinutes - t.estimatedMinutes,
      efficiency: calculateEfficiency(t.estimatedMinutes, actualMinutes),
    };
  });
}

/** Portfolio totals for the overview dashboard (§9). */
export async function portfolioSummary(actor: Actor) {
  const ventureIds = resolveVentureIds(actor);

  const [openTasks, overdueTasks, completed] = await Promise.all([
    prisma.task.count({
      where: {
        archivedAt: null,
        status: { not: "DONE" },
        ...(ventureIds ? { ventureId: { in: ventureIds } } : {}),
      },
    }),
    prisma.task.count({
      where: {
        archivedAt: null,
        status: { not: "DONE" },
        dueDate: { lt: new Date() },
        ...(ventureIds ? { ventureId: { in: ventureIds } } : {}),
      },
    }),
    prisma.task.findMany({
      where: {
        archivedAt: null,
        status: "DONE",
        ...(ventureIds ? { ventureId: { in: ventureIds } } : {}),
      },
      select: { id: true, estimatedMinutes: true },
    }),
  ]);

  const actuals = await prisma.timeEntry.groupBy({
    by: ["taskId"],
    where: { taskId: { in: completed.map((t) => t.id) }, durationSeconds: { not: null } },
    _sum: { durationSeconds: true },
  });
  const actualByTask = new Map(
    actuals.map((a) => [a.taskId, Math.round((a._sum.durationSeconds ?? 0) / 60)]),
  );

  const efficiency = aggregateEfficiency(
    completed.map((t) => ({
      estimatedMinutes: t.estimatedMinutes,
      actualMinutes: actualByTask.get(t.id) ?? 0,
    })),
  );

  return { openTasks, overdueTasks, completedTasks: completed.length, efficiency };
}

/** Hours logged today, in each venture's own business day (§9). */
export async function hoursToday(actor: Actor): Promise<number> {
  const ventureIds = resolveVentureIds(actor);
  const ventures = await prisma.venture.findMany({
    where: { archivedAt: null, ...(ventureIds ? { id: { in: ventureIds } } : {}) },
    select: { id: true, timezone: true },
  });

  let totalMinutes = 0;
  for (const venture of ventures) {
    const { currentBusinessDate } = await import("@/lib/timezone/businessDate");
    const today = currentBusinessDate(venture.timezone);
    const result = await prisma.timeEntry.aggregate({
      where: { ventureId: venture.id, businessDate: toPrismaDate(today) },
      _sum: { durationSeconds: true },
    });
    totalMinutes += Math.round((result._sum.durationSeconds ?? 0) / 60);
  }
  return totalMinutes;
}

export type AttendanceSnapshot = {
  present: number;
  remote: number;
  onLeave: number;
  absent: number;
  noSubmission: number;
  totalExpected: number;
};

/**
 * Today's attendance across the ventures the actor can see (§9).
 *
 * "No submission" is everyone expected to log who has not, so the four status
 * counts plus that always add up to the number of active people.
 */
export async function attendanceSnapshot(
  actor: Actor,
  businessDate?: BusinessDate,
): Promise<AttendanceSnapshot> {
  const ventureIds = resolveVentureIds(actor);
  if (ventureIds !== null && ventureIds?.length === 0) {
    return { present: 0, remote: 0, onLeave: 0, absent: 0, noSubmission: 0, totalExpected: 0 };
  }

  const ventures = await prisma.venture.findMany({
    where: { archivedAt: null, ...(ventureIds ? { id: { in: ventureIds } } : {}) },
    select: { id: true, timezone: true },
  });

  const { currentBusinessDate } = await import("@/lib/timezone/businessDate");

  let present = 0;
  let remote = 0;
  let onLeave = 0;
  let absent = 0;
  let totalExpected = 0;
  let submitted = 0;

  for (const venture of ventures) {
    const date = businessDate ?? currentBusinessDate(venture.timezone);

    const members = await prisma.ventureMembership.count({
      where: {
        ventureId: venture.id,
        leftAt: null,
        person: { archivedAt: null, user: { accountStatus: "ACTIVE" } },
      },
    });
    totalExpected += members;

    const logs = await prisma.dailyLog.groupBy({
      by: ["attendanceStatus"],
      where: { ventureId: venture.id, businessDate: toPrismaDate(date) },
      _count: true,
    });

    for (const row of logs) {
      submitted += row._count;
      if (row.attendanceStatus === "PRESENT") present += row._count;
      else if (row.attendanceStatus === "REMOTE") remote += row._count;
      else if (row.attendanceStatus === "ON_LEAVE") onLeave += row._count;
      else if (row.attendanceStatus === "ABSENT") absent += row._count;
    }
  }

  return {
    present,
    remote,
    onLeave,
    absent,
    noSubmission: Math.max(0, totalExpected - submitted),
    totalExpected,
  };
}

export type WorkloadRow = {
  personId: string;
  personName: string;
  ventureNames: string[];
  assignedEstimateMinutes: number;
  loggedMinutes: number;
  /** Logged against assigned estimate. Over 100% means more time than planned. */
  capacityPercent: number | null;
};

/**
 * Who is carrying how much open work (§9 Workload).
 *
 * Counts only tasks that are still open — completed work is history, not load.
 */
export async function workloadSnapshot(actor: Actor): Promise<WorkloadRow[]> {
  const ventureIds = resolveVentureIds(actor);
  if (ventureIds !== null && ventureIds?.length === 0) return [];

  const people = await prisma.person.findMany({
    where: {
      archivedAt: null,
      user: { accountStatus: "ACTIVE" },
      ...(ventureIds
        ? { memberships: { some: { ventureId: { in: ventureIds }, leftAt: null } } }
        : {}),
    },
    select: {
      id: true,
      user: { select: { name: true } },
      memberships: {
        where: { leftAt: null },
        select: { venture: { select: { name: true } } },
      },
    },
  });

  const rows: WorkloadRow[] = [];

  for (const person of people) {
    const assigned = await prisma.taskAssignee.findMany({
      where: {
        personId: person.id,
        task: {
          archivedAt: null,
          status: { not: "DONE" },
          ...(ventureIds ? { ventureId: { in: ventureIds } } : {}),
        },
      },
      select: { task: { select: { id: true, estimatedMinutes: true } } },
    });

    if (assigned.length === 0) continue;

    const estimate = assigned.reduce((s, a) => s + a.task.estimatedMinutes, 0);

    const logged = await prisma.timeEntry.aggregate({
      where: {
        taskId: { in: assigned.map((a) => a.task.id) },
        personId: person.id,
        durationSeconds: { not: null },
      },
      _sum: { durationSeconds: true },
    });
    const loggedMinutes = Math.round((logged._sum.durationSeconds ?? 0) / 60);

    rows.push({
      personId: person.id,
      personName: person.user.name,
      ventureNames: [...new Set(person.memberships.map((m) => m.venture.name))],
      assignedEstimateMinutes: estimate,
      loggedMinutes,
      capacityPercent: estimate === 0 ? null : (loggedMinutes / estimate) * 100,
    });
  }

  return rows.sort((a, b) => b.assignedEstimateMinutes - a.assignedEstimateMinutes);
}

/** CSV export, built server-side from exactly what the caller may see (§62). */
export function toCsv(rows: Record<string, unknown>[], columns: { key: string; label: string }[]): string {
  const escape = (v: unknown) => {
    if (v === null || v === undefined) return "";
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const header = columns.map((c) => escape(c.label)).join(",");
  const body = rows.map((r) => columns.map((c) => escape(r[c.key])).join(",")).join("\n");
  return `${header}\n${body}`;
}

export function isSuperAdminActor(actor: Actor): boolean {
  return isSuperAdmin(actor);
}
