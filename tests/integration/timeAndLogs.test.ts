import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { testPrisma as prisma } from "../helpers/testPrisma";
import { startTimer, stopTimer, saveManualEntry, getActiveTimer, listEntriesForDay } from "@/modules/time/time.service";
import {
  getMyDay,
  submitLog,
  approveLog,
  getLog,
  listPendingApprovals,
  countPendingApprovals,
} from "@/modules/dailyLogs/dailyLog.service";
import { createTask, changeTaskStatus, listTasks } from "@/modules/tasks/task.service";
import type { Actor, ActorWithVenture } from "@/lib/permissions/types";
import { isAppError } from "@/lib/errors/appError";
import {
  fromPrismaDate,
  toPrismaDate,
  currentBusinessDate,
} from "@/lib/timezone/businessDate";

/** Today in the venture timezone — fixed dates would fall outside the 48h
 *  edit window as soon as the clock rolls past midnight. */
const TODAY = currentBusinessDate("Asia/Kolkata");
/** Yesterday, still inside a 48h edit window, for tests needing a second day. */
const YESTERDAY = currentBusinessDate(
  "Asia/Kolkata",
  new Date(Date.now() - 24 * 3600 * 1000),
);

/**
 * The core-chain invariants, tested against a real database:
 *   Task -> TimeEntry -> DailyLog -> Approval
 *
 * These are the rules that would silently corrupt payroll if they broke, so
 * they are exercised through the real services rather than mocks.
 */

const S = `tl${Date.now().toString(36)}`;
const ids: Record<string, string> = {};

function baseActor(overrides: Partial<Actor> = {}): Actor {
  return {
    userId: ids.empUser,
    personId: ids.empPerson,
    name: "Employee",
    email: `emp-${S}@test.local`,
    globalRole: "USER",
    accountStatus: "ACTIVE",
    memberships: new Map([[ids.venture, "MEMBER"]]),
    ...overrides,
  };
}

function ventureActor(base: Actor, role: "MANAGER" | "MEMBER" | null): ActorWithVenture {
  return {
    ...base,
    venture: {
      id: ids.venture,
      name: `TL ${S}`,
      slug: `tl-${S}`,
      timezone: "Asia/Kolkata",
      workingDays: [1, 2, 3, 4, 5],
      dailyLogEditWindowHours: 48,
      defaultCurrency: "INR",
    },
    ventureRole: role,
  };
}

beforeAll(async () => {
  const venture = await prisma.venture.create({
    data: { name: `TL ${S}`, slug: `tl-${S}`, timezone: "Asia/Kolkata" },
  });
  ids.venture = venture.id;

  const emp = await prisma.user.create({
    data: {
      name: "Employee",
      email: `emp-${S}@test.local`,
      accountStatus: "ACTIVE",
      person: { create: { employmentType: "EMPLOYEE" } },
    },
    include: { person: true },
  });
  ids.empUser = emp.id;
  ids.empPerson = emp.person!.id;

  const mgr = await prisma.user.create({
    data: {
      name: "Manager",
      email: `mgr-${S}@test.local`,
      accountStatus: "ACTIVE",
      person: { create: { employmentType: "EMPLOYEE" } },
    },
    include: { person: true },
  });
  ids.mgrUser = mgr.id;
  ids.mgrPerson = mgr.person!.id;

  await prisma.ventureMembership.createMany({
    data: [
      { ventureId: venture.id, personId: ids.empPerson, accessRole: "MEMBER" },
      { ventureId: venture.id, personId: ids.mgrPerson, accessRole: "MANAGER" },
    ],
  });
});

afterAll(async () => {
  await prisma.timeEntry.deleteMany({ where: { ventureId: ids.venture } });
  await prisma.dailyLog.deleteMany({ where: { ventureId: ids.venture } });
  await prisma.taskStatusHistory.deleteMany({ where: { task: { ventureId: ids.venture } } });
  await prisma.taskAssignee.deleteMany({ where: { task: { ventureId: ids.venture } } });
  await prisma.task.deleteMany({ where: { ventureId: ids.venture } });
  await prisma.auditLog.deleteMany({
    where: { actorUserId: { in: [ids.empUser, ids.mgrUser] } },
  });
  await prisma.ventureMembership.deleteMany({ where: { ventureId: ids.venture } });
  await prisma.person.deleteMany({ where: { id: { in: [ids.empPerson, ids.mgrPerson] } } });
  await prisma.user.deleteMany({ where: { id: { in: [ids.empUser, ids.mgrUser] } } });
  await prisma.venture.delete({ where: { id: ids.venture } });
  await prisma.$disconnect();
});

describe("timer rules (§20, §21)", () => {
  it("refuses a second timer while one is running", async () => {
    const actor = ventureActor(baseActor(), "MEMBER");

    const first = await startTimer(actor, { note: "first" });
    expect(first.running).toBe(true);

    await expect(startTimer(actor, { note: "second" })).rejects.toSatisfy(
      (e: unknown) => isAppError(e) && e.code === "ACTIVE_TIMER_EXISTS",
    );

    await stopTimer(actor);
    expect(await getActiveTimer(ids.empPerson)).toBeNull();
  });

  it("computes duration server-side and allows a new timer after stopping", async () => {
    const actor = ventureActor(baseActor(), "MEMBER");

    await startTimer(actor, { note: "measured" });
    const stopped = await stopTimer(actor);

    expect(stopped.running).toBe(false);
    expect(stopped.durationSeconds).not.toBeNull();
    expect(stopped.durationSeconds!).toBeGreaterThanOrEqual(0);
    // A fresh timer must now be allowed.
    const next = await startTimer(actor, {});
    expect(next.running).toBe(true);
    await stopTimer(actor);
  });

  it("links every entry to a daily log at start, leaving no orphans", async () => {
    const actor = ventureActor(baseActor(), "MEMBER");
    const entry = await startTimer(actor, {});
    await stopTimer(actor);

    const row = await prisma.timeEntry.findUnique({
      where: { id: entry.id },
      select: { dailyLogId: true },
    });
    expect(row?.dailyLogId).not.toBeNull();
  });
});

describe("daily log does not duplicate time (§27)", () => {
  it("editing a manual row twice leaves exactly one entry", async () => {
    const actor = ventureActor(baseActor(), "MEMBER");
    const date = "2026-08-20";

    const created = await saveManualEntry(actor, { businessDate: date, minutes: 120, note: "Worked on the assigned task" });
    const edited1 = await saveManualEntry(actor, {
      entryId: created.id,
      businessDate: date,
      minutes: 180,
      note: "Worked on the assigned task",
    });
    const edited2 = await saveManualEntry(actor, {
      entryId: created.id,
      businessDate: date,
      minutes: 90,
      note: "Worked on the assigned task",
    });

    expect(edited1.id).toBe(created.id);
    expect(edited2.id).toBe(created.id);

    const entries = await listEntriesForDay(ids.empPerson, ids.venture, date);
    expect(entries).toHaveLength(1);
    expect(entries[0].durationMinutes).toBe(90);

    await prisma.timeEntry.deleteMany({ where: { id: created.id } });
  });

  it("totals the day from entries with no stored total column", async () => {
    const actor = ventureActor(baseActor(), "MEMBER");
    const date = "2026-08-21";

    await saveManualEntry(actor, { businessDate: date, minutes: 180, note: "Worked on the assigned task" });
    await saveManualEntry(actor, { businessDate: date, minutes: 120, note: "Worked on the assigned task" });
    await saveManualEntry(actor, { businessDate: date, minutes: 120, note: "Worked on the assigned task" });

    const logs = await getMyDay(baseActor(), date);
    const log = logs.find((l) => l.ventureId === ids.venture);

    // 3h + 2h + 2h = 7h, exactly the spec's worked example.
    expect(log?.totalMinutes).toBe(420);
    expect(log?.entries).toHaveLength(3);
  });
});

describe("task actual hours come from time entries (§23)", () => {
  it("aggregates entry durations onto the task", async () => {
    const manager = ventureActor(
      baseActor({
        userId: ids.mgrUser,
        personId: ids.mgrPerson,
        memberships: new Map([[ids.venture, "MANAGER"]]),
      }),
      "MANAGER",
    );

    const task = await createTask(manager, {
      ventureId: ids.venture,
      title: `Aggregation ${S}`,
      estimatedHours: 8, // 480 minutes
      priority: "MEDIUM",
      assigneeIds: [ids.empPerson],
    });

    expect(task.estimatedMinutes).toBe(480);
    expect(task.actualMinutes).toBe(0);
    expect(task.efficiency).toBeNull(); // §24: no actual time -> not calculable

    const employee = ventureActor(baseActor(), "MEMBER");
    await saveManualEntry(employee, {
      taskId: task.id,
      businessDate: "2026-08-22",
      minutes: 600,
      note: "Worked on the assigned task", // 10h
    });

    const tasks = await listTasks(baseActor(), { ventureId: ids.venture });
    const found = tasks.find((t) => t.id === task.id);

    expect(found?.actualMinutes).toBe(600);
    // 480 estimated / 600 actual = 80%
    expect(found?.efficiency).toBe(80);
  });

  it("records status history and refuses a backward move by a member", async () => {
    const manager = ventureActor(
      baseActor({
        userId: ids.mgrUser,
        personId: ids.mgrPerson,
        memberships: new Map([[ids.venture, "MANAGER"]]),
      }),
      "MANAGER",
    );

    const task = await createTask(manager, {
      ventureId: ids.venture,
      title: `Transitions ${S}`,
      estimatedHours: 2,
      priority: "LOW",
      assigneeIds: [],
    });

    await changeTaskStatus(manager, { taskId: task.id, status: "IN_PROGRESS" });
    const done = await changeTaskStatus(manager, { taskId: task.id, status: "DONE" });
    expect(done.status).toBe("DONE");
    expect(done.completedAt).not.toBeNull();

    // A member may not drag it backwards, even though the UI might allow it.
    const member = ventureActor(baseActor(), "MEMBER");
    await expect(
      changeTaskStatus(member, { taskId: task.id, status: "BACKLOG" }),
    ).rejects.toSatisfy((e: unknown) => isAppError(e) && e.code === "FORBIDDEN");

    const history = await prisma.taskStatusHistory.findMany({ where: { taskId: task.id } });
    expect(history.length).toBeGreaterThanOrEqual(3); // created + 2 transitions
  });
});

describe("approval lifecycle (§28, §31)", () => {
  it("submits, approves, and then locks the day against employee edits", async () => {
    const date = TODAY;
    const employee = ventureActor(baseActor(), "MEMBER");
    await saveManualEntry(employee, { businessDate: date, minutes: 240, note: "Worked on the assigned task" });

    const logs = await getMyDay(baseActor(), date);
    const log = logs.find((l) => l.ventureId === ids.venture)!;

    const submitted = await submitLog(baseActor(), log.id);
    expect(submitted.status).toBe("SUBMITTED");

    const manager = ventureActor(
      baseActor({
        userId: ids.mgrUser,
        personId: ids.mgrPerson,
        memberships: new Map([[ids.venture, "MANAGER"]]),
      }),
      "MANAGER",
    );
    await approveLog(manager, log.id);

    const after = await getLog(baseActor(), log.id);
    expect(after.status).toBe("APPROVED");

    // Once approved, the employee can no longer add time to that day.
    await expect(
      saveManualEntry(employee, { businessDate: date, minutes: 60, note: "Worked on the assigned task" }),
    ).rejects.toSatisfy((e: unknown) => isAppError(e) && e.code === "EDIT_WINDOW_CLOSED");
  });

  it("refuses to approve your own timesheet", async () => {
    const date = YESTERDAY;
    const manager = ventureActor(
      baseActor({
        userId: ids.mgrUser,
        personId: ids.mgrPerson,
        memberships: new Map([[ids.venture, "MANAGER"]]),
      }),
      "MANAGER",
    );

    await saveManualEntry(manager, { businessDate: date, minutes: 120, note: "Worked on the assigned task" });
    const logs = await getMyDay(
      baseActor({
        userId: ids.mgrUser,
        personId: ids.mgrPerson,
        memberships: new Map([[ids.venture, "MANAGER"]]),
      }),
      date,
    );
    const log = logs.find((l) => l.ventureId === ids.venture)!;

    await submitLog(
      baseActor({ userId: ids.mgrUser, personId: ids.mgrPerson }),
      log.id,
    );

    await expect(approveLog(manager, log.id)).rejects.toSatisfy(
      (e: unknown) => isAppError(e) && e.code === "FORBIDDEN",
    );
  });

  it("blocks submission when attendance conflicts with logged hours (§30)", async () => {
    const date = TODAY;

    // An earlier test approved this day; reopen it so this one starts clean.
    await prisma.dailyLog.updateMany({
      where: { personId: ids.empPerson, ventureId: ids.venture },
      data: { status: "DRAFT", approvedAt: null, approvedBy: null, submittedAt: null },
    });

    const employee = ventureActor(baseActor(), "MEMBER");
    await saveManualEntry(employee, { businessDate: date, minutes: 360, note: "Worked on the assigned task" });

    const logs = await getMyDay(baseActor(), date);
    const log = logs.find((l) => l.ventureId === ids.venture)!;

    await prisma.dailyLog.update({
      where: { id: log.id },
      data: { attendanceStatus: "ABSENT" },
    });

    // Absent + 6 logged hours must be refused, not silently accepted.
    await expect(submitLog(baseActor(), log.id)).rejects.toSatisfy(
      (e: unknown) => isAppError(e) && e.code === "CONFLICT",
    );
  });

  it("refuses to submit a day with a timer still running", async () => {
    const date = currentBusinessDate("Asia/Kolkata");
    const employee = ventureActor(baseActor(), "MEMBER");

    // A running timer's hours are not in the total yet, so submitting would
    // have them land after a manager had already approved the day.
    await startTimer(employee, { note: "still going" });

    const logs = await getMyDay(baseActor(), date);
    const log = logs.find((l) => l.ventureId === ids.venture)!;

    // The previous test left this day marked ABSENT; reset it so the running
    // timer is the only reason a submit could be refused.
    await prisma.dailyLog.update({
      where: { id: log.id },
      data: { attendanceStatus: "PRESENT" },
    });

    await expect(submitLog(baseActor(), log.id)).rejects.toSatisfy(
      (e: unknown) => isAppError(e) && e.code === "CONFLICT",
    );

    // Once stopped, the same day submits.
    await stopTimer(employee);
    const after = await submitLog(baseActor(), log.id);
    expect(after.status).toBe("SUBMITTED");
  });
});

describe("approval queue ordering (§31)", () => {
  it("lists the oldest submitted days first, so none get stranded", async () => {
    const manager = ventureActor(
      baseActor({
        userId: ids.mgrUser,
        personId: ids.mgrPerson,
        memberships: new Map([[ids.venture, "MANAGER"]]),
      }),
      "MANAGER",
    );

    // Two submitted days for the employee, a week apart.
    const older = "2026-08-10";
    const newer = "2026-08-17";

    for (const date of [older, newer]) {
      const log = await prisma.dailyLog.upsert({
        where: {
          personId_ventureId_businessDate: {
            personId: ids.empPerson,
            ventureId: ids.venture,
            businessDate: toPrismaDate(date),
          },
        },
        update: { status: "SUBMITTED", submittedAt: new Date() },
        create: {
          personId: ids.empPerson,
          ventureId: ids.venture,
          businessDate: toPrismaDate(date),
          status: "SUBMITTED",
          attendanceStatus: "PRESENT",
          submittedAt: new Date(),
        },
        select: { id: true },
      });
      await prisma.timeEntry.create({
        data: {
          personId: ids.empPerson,
          ventureId: ids.venture,
          dailyLogId: log.id,
          source: "MANUAL",
          startedAt: new Date(`${date}T09:00:00Z`),
          endedAt: new Date(`${date}T10:00:00Z`),
          durationSeconds: 3600,
          businessDate: toPrismaDate(date),
        },
      });
    }

    const queue = await listPendingApprovals(manager);
    const dates = queue.map((l) => l.businessDate);
    const olderAt = dates.indexOf(older);
    const newerAt = dates.indexOf(newer);

    expect(olderAt).toBeGreaterThanOrEqual(0);
    expect(newerAt).toBeGreaterThanOrEqual(0);
    // The day waiting longest must come first.
    expect(olderAt).toBeLessThan(newerAt);

    // And the count reflects the true total, not just what fits on screen.
    expect(await countPendingApprovals(manager)).toBeGreaterThanOrEqual(2);
  });
});

describe("completed tasks are final (business rule)", () => {
  it("refuses to reopen a DONE task for a manager, but allows a Super Admin", async () => {
    const manager = ventureActor(
      baseActor({
        userId: ids.mgrUser,
        personId: ids.mgrPerson,
        memberships: new Map([[ids.venture, "MANAGER"]]),
      }),
      "MANAGER",
    );

    const task = await createTask(manager, {
      ventureId: ids.venture,
      title: `Final ${S}`,
      estimatedHours: 2,
      priority: "LOW",
      assigneeIds: [],
    });

    await changeTaskStatus(manager, { taskId: task.id, status: "IN_PROGRESS" });
    await changeTaskStatus(manager, { taskId: task.id, status: "DONE" });

    // A manager cannot undo completion — its hours have already fed reporting.
    await expect(
      changeTaskStatus(manager, { taskId: task.id, status: "IN_PROGRESS" }),
    ).rejects.toSatisfy((e: unknown) => isAppError(e) && e.code === "FORBIDDEN");

    // A Super Admin can, so a genuine mistake is still correctable.
    const admin = ventureActor(
      baseActor({
        userId: ids.mgrUser,
        personId: ids.mgrPerson,
        globalRole: "SUPER_ADMIN",
        memberships: new Map([[ids.venture, "MANAGER"]]),
      }),
      "MANAGER",
    );
    const reopened = await changeTaskStatus(admin, {
      taskId: task.id,
      status: "IN_PROGRESS",
    });
    expect(reopened.status).toBe("IN_PROGRESS");

    // ...and the reopen is recorded distinctly in the audit trail.
    const audit = await prisma.auditLog.findFirst({
      where: { entityType: "Task", entityId: task.id, action: "TASK_STATUS_CHANGED" },
      orderBy: { createdAt: "desc" },
    });
    expect(audit?.reason).toMatch(/reopened/i);
  });
});

describe("business date attribution (§22)", () => {
  it("stores the venture-local date, not the UTC date", async () => {
    const actor = ventureActor(baseActor(), "MEMBER");
    const entry = await saveManualEntry(actor, {
      businessDate: "2026-08-28",
      minutes: 60,
      note: "Worked on the assigned task",
    });

    const row = await prisma.timeEntry.findUnique({
      where: { id: entry.id },
      select: { businessDate: true },
    });
    expect(fromPrismaDate(row!.businessDate)).toBe("2026-08-28");
  });
});
