import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { testPrisma as prisma } from "../helpers/testPrisma";
import {
  createTask,
  changeTaskStatus,
  deleteTask,
  restoreTask,
  listTasks,
} from "@/modules/tasks/task.service";
import type { Actor, ActorWithVenture } from "@/lib/permissions/types";
import { isAppError } from "@/lib/errors/appError";

/**
 * Completed tasks leaving the board, and what can be done with them afterwards.
 *
 * Auto-archiving changes data because of a counter rather than a person's
 * decision, so the count, the choice of which task goes, and the recovery path
 * all need to hold against a real database.
 */

const S = `ta${Date.now().toString(36)}`;
const ids: Record<string, string> = {};

function actor(role: "MANAGER" | "MEMBER" = "MANAGER"): ActorWithVenture {
  const base: Actor = {
    userId: ids.user,
    personId: ids.person,
    name: "Manager",
    email: `mgr-${S}@test.local`,
    globalRole: "USER",
    accountStatus: "ACTIVE",
    memberships: new Map([[ids.venture, role]]),
  };
  return {
    ...base,
    venture: {
      id: ids.venture,
      name: `TA ${S}`,
      slug: `ta-${S}`,
      timezone: "Asia/Kolkata",
      workingDays: [1, 2, 3, 4, 5],
      dailyLogEditWindowHours: 48,
      defaultCurrency: "INR",
    },
    ventureRole: role,
  };
}

/** Create a task and drive it to DONE, returning its id. */
async function completeTask(title: string): Promise<string> {
  const task = await createTask(actor(), {
    ventureId: ids.venture,
    title,
    estimatedHours: 1,
    priority: "MEDIUM",
    assigneeIds: [],
  });
  await changeTaskStatus(actor(), { taskId: task.id, status: "DONE" });
  return task.id;
}

beforeAll(async () => {
  const venture = await prisma.venture.create({
    data: { name: `TA ${S}`, slug: `ta-${S}`, timezone: "Asia/Kolkata" },
  });
  ids.venture = venture.id;

  const user = await prisma.user.create({
    data: {
      name: "Manager",
      email: `mgr-${S}@test.local`,
      accountStatus: "ACTIVE",
      person: { create: { employmentType: "EMPLOYEE" } },
    },
    include: { person: true },
  });
  ids.user = user.id;
  ids.person = user.person!.id;

  await prisma.ventureMembership.create({
    data: { ventureId: ids.venture, personId: ids.person, accessRole: "MANAGER" },
  });
});

afterAll(async () => {
  await prisma.timeEntry.deleteMany({ where: { ventureId: ids.venture } });
  await prisma.dailyLog.deleteMany({ where: { ventureId: ids.venture } });
  await prisma.taskStatusHistory.deleteMany({ where: { task: { ventureId: ids.venture } } });
  await prisma.taskAssignee.deleteMany({ where: { task: { ventureId: ids.venture } } });
  await prisma.task.deleteMany({ where: { ventureId: ids.venture } });
  await prisma.auditLog.deleteMany({ where: { actorUserId: ids.user } });
  await prisma.ventureMembership.deleteMany({ where: { ventureId: ids.venture } });
  await prisma.person.deleteMany({ where: { id: ids.person } });
  await prisma.user.deleteMany({ where: { id: ids.user } });
  await prisma.venture.deleteMany({ where: { id: ids.venture } });
});

describe("completed tasks leaving the board", () => {
  it("keeps five on the board and archives the sixth-oldest", async () => {
    const created: string[] = [];
    for (let i = 1; i <= 5; i++) {
      created.push(await completeTask(`Done ${i} ${S}`));
    }

    let live = await listTasks(actor(), { ventureId: ids.venture, status: "DONE" });
    expect(live).toHaveLength(5);

    // The sixth completion pushes the oldest off the board.
    created.push(await completeTask(`Done 6 ${S}`));

    live = await listTasks(actor(), { ventureId: ids.venture, status: "DONE" });
    expect(live).toHaveLength(5);

    const first = await prisma.task.findUnique({ where: { id: created[0] } });
    expect(first?.archivedAt).not.toBeNull();

    // ...and it is the OLDEST that goes, not an arbitrary one.
    const stillLive = live.map((t) => t.id);
    expect(stillLive).not.toContain(created[0]);
    expect(stillLive).toContain(created[5]);
  });

  it("shows the archived task in the archive view", async () => {
    const archived = await listTasks(actor(), {
      ventureId: ids.venture,
      archivedOnly: true,
    });
    expect(archived.length).toBeGreaterThan(0);
    expect(archived.every((t) => t.archived)).toBe(true);
  });

  it("records the automatic archive as such in the audit log", async () => {
    const entry = await prisma.auditLog.findFirst({
      where: { action: "TASK_ARCHIVED", actorUserId: ids.user },
      orderBy: { createdAt: "desc" },
    });
    expect(entry?.reason).toContain("Archived automatically");
  });

  it("does not archive anything while five or fewer are done", async () => {
    const other = await prisma.venture.create({
      data: { name: `TA2 ${S}`, slug: `ta2-${S}`, timezone: "Asia/Kolkata" },
    });
    await prisma.ventureMembership.create({
      data: { ventureId: other.id, personId: ids.person, accessRole: "MANAGER" },
    });

    const a = actor();
    const scoped: ActorWithVenture = {
      ...a,
      memberships: new Map([[other.id, "MANAGER"]]),
      venture: { ...a.venture, id: other.id, name: `TA2 ${S}`, slug: `ta2-${S}` },
    };

    for (let i = 1; i <= 3; i++) {
      const t = await createTask(scoped, {
        ventureId: other.id,
        title: `Small ${i} ${S}`,
        estimatedHours: 1,
        priority: "MEDIUM",
        assigneeIds: [],
      });
      await changeTaskStatus(scoped, { taskId: t.id, status: "DONE" });
    }

    const archived = await prisma.task.count({
      where: { ventureId: other.id, archivedAt: { not: null } },
    });
    expect(archived).toBe(0);

    await prisma.taskStatusHistory.deleteMany({ where: { task: { ventureId: other.id } } });
    await prisma.task.deleteMany({ where: { ventureId: other.id } });
    await prisma.ventureMembership.deleteMany({ where: { ventureId: other.id } });
    await prisma.venture.deleteMany({ where: { id: other.id } });
  });
});

describe("acting on an archived task", () => {
  it("restores it to the live board", async () => {
    const archived = await listTasks(actor(), { ventureId: ids.venture, archivedOnly: true });
    const target = archived[0]!;

    await restoreTask(actor(), target.id);

    const row = await prisma.task.findUnique({ where: { id: target.id } });
    expect(row?.archivedAt).toBeNull();
  });

  it("refuses to delete a task that is not archived", async () => {
    const task = await createTask(actor(), {
      ventureId: ids.venture,
      title: `Live ${S}`,
      estimatedHours: 1,
      priority: "MEDIUM",
      assigneeIds: [],
    });

    await expect(deleteTask(actor(), task.id)).rejects.toSatisfy(
      (e) => isAppError(e) && e.code === "CONFLICT",
    );
  });

  it("refuses to delete a task that has logged time", async () => {
    const task = await createTask(actor(), {
      ventureId: ids.venture,
      title: `Worked ${S}`,
      estimatedHours: 1,
      priority: "MEDIUM",
      assigneeIds: [],
    });
    await prisma.task.update({
      where: { id: task.id },
      data: { archivedAt: new Date() },
    });
    await prisma.timeEntry.create({
      data: {
        taskId: task.id,
        personId: ids.person,
        ventureId: ids.venture,
        source: "MANUAL",
        startedAt: new Date(),
        endedAt: new Date(),
        durationSeconds: 1800,
        businessDate: new Date("2026-08-31T00:00:00Z"),
      },
    });

    await expect(deleteTask(actor(), task.id)).rejects.toSatisfy(
      (e) => isAppError(e) && e.code === "CONFLICT",
    );

    // Still there: the hours keep their history.
    expect(await prisma.task.count({ where: { id: task.id } })).toBe(1);
  });

  it("deletes an archived task with no logged time", async () => {
    const task = await createTask(actor(), {
      ventureId: ids.venture,
      title: `Disposable ${S}`,
      estimatedHours: 1,
      priority: "MEDIUM",
      assigneeIds: [],
    });
    await prisma.task.update({ where: { id: task.id }, data: { archivedAt: new Date() } });

    await deleteTask(actor(), task.id);

    expect(await prisma.task.count({ where: { id: task.id } })).toBe(0);

    // The audit row outlives the task it describes.
    const entry = await prisma.auditLog.findFirst({
      where: { action: "TASK_DELETED", entityId: task.id },
    });
    expect(entry).not.toBeNull();
  });

  it("refuses deletion by a plain member", async () => {
    const task = await createTask(actor(), {
      ventureId: ids.venture,
      title: `Member cannot delete ${S}`,
      estimatedHours: 1,
      priority: "MEDIUM",
      assigneeIds: [],
    });
    await prisma.task.update({ where: { id: task.id }, data: { archivedAt: new Date() } });

    await expect(deleteTask(actor("MEMBER"), task.id)).rejects.toSatisfy(
      (e) => isAppError(e) && e.code === "FORBIDDEN",
    );
  });
});
