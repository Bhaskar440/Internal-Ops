import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { testPrisma as prisma } from "../helpers/testPrisma";
import { submitLog, approveLog, rejectLog, getMyDay } from "@/modules/dailyLogs/dailyLog.service";
import { saveManualEntry } from "@/modules/time/time.service";
import { createTask } from "@/modules/tasks/task.service";
import { listMyNotifications } from "@/modules/notifications/notification.service";
import { currentBusinessDate } from "@/lib/timezone/businessDate";
import type { Actor, ActorWithVenture } from "@/lib/permissions/types";

/**
 * Notifications following a day around the loop (§59).
 *
 * The point of this feature is that nobody has to poll a queue: submitting
 * reaches the approvers, and the outcome reaches the person who submitted.
 * Both directions are checked, along with the rule that alerts stay private.
 */

const S = `ln${Date.now().toString(36)}`;
const ids: Record<string, string> = {};

function employee(): Actor {
  return {
    userId: ids.empUser,
    personId: ids.empPerson,
    name: "Employee",
    email: `emp-${S}@test.local`,
    globalRole: "USER",
    accountStatus: "ACTIVE",
    memberships: new Map([[ids.venture, "MEMBER"]]),
  };
}

function manager(): ActorWithVenture {
  const base: Actor = {
    userId: ids.mgrUser,
    personId: ids.mgrPerson,
    name: "Manager",
    email: `mgr-${S}@test.local`,
    globalRole: "USER",
    accountStatus: "ACTIVE",
    memberships: new Map([[ids.venture, "MANAGER"]]),
  };
  return {
    ...base,
    venture: {
      id: ids.venture,
      name: `LN ${S}`,
      slug: `ln-${S}`,
      timezone: "Asia/Kolkata",
      workingDays: [1, 2, 3, 4, 5],
      dailyLogEditWindowHours: 48,
      defaultCurrency: "INR",
    },
    ventureRole: "MANAGER",
  };
}

async function makePerson(label: string, role: "MANAGER" | "MEMBER") {
  const user = await prisma.user.create({
    data: {
      name: label,
      email: `${label}-${S}@test.local`,
      accountStatus: "ACTIVE",
      person: { create: { employmentType: "EMPLOYEE" } },
    },
    include: { person: true },
  });
  await prisma.ventureMembership.create({
    data: { ventureId: ids.venture, personId: user.person!.id, accessRole: role },
  });
  return { userId: user.id, personId: user.person!.id };
}

/** The employee as a venture-scoped actor, which time entry requires. */
function employeeInVenture(ventureId = ids.venture, name = `LN ${S}`, slug = `ln-${S}`): ActorWithVenture {
  return {
    ...employee(),
    memberships: new Map([[ventureId, "MEMBER"]]),
    venture: {
      id: ventureId,
      name,
      slug,
      timezone: "Asia/Kolkata",
      workingDays: [1, 2, 3, 4, 5],
      dailyLogEditWindowHours: 48,
      defaultCurrency: "INR",
    },
    ventureRole: "MEMBER",
  };
}

/** Submit a day with an hour on it, returning the log id. */
async function submitADay(): Promise<string> {
  const today = currentBusinessDate("Asia/Kolkata");
  // Recording time creates the day's log, which is then submitted.
  await saveManualEntry(employeeInVenture(), {
    taskId: ids.task,
    minutes: 60,
    businessDate: today,
  });
  const days = await getMyDay(employee(), today);
  const log = days.find((d) => d.ventureId === ids.venture)!;
  await submitLog(employee(), log.id);
  return log.id;
}

beforeAll(async () => {
  const venture = await prisma.venture.create({
    data: { name: `LN ${S}`, slug: `ln-${S}`, timezone: "Asia/Kolkata" },
  });
  ids.venture = venture.id;

  const emp = await makePerson("emp", "MEMBER");
  ids.empUser = emp.userId;
  ids.empPerson = emp.personId;

  const mgr = await makePerson("mgr", "MANAGER");
  ids.mgrUser = mgr.userId;
  ids.mgrPerson = mgr.personId;

  const task = await createTask(manager(), {
    ventureId: ids.venture,
    title: `Work ${S}`,
    estimatedHours: 2,
    priority: "MEDIUM",
    assigneeIds: [ids.empPerson],
  });
  ids.task = task.id;
});

afterAll(async () => {
  await prisma.notification.deleteMany({
    where: { personId: { in: [ids.empPerson, ids.mgrPerson] } },
  });
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
  await prisma.venture.deleteMany({ where: { id: ids.venture } });
});

describe("submitting a day", () => {
  it("alerts the venture manager", async () => {
    ids.log = await submitADay();

    const alerts = await listMyNotifications(manager());
    const submitted = alerts.find((n) => n.kind === "DAILY_LOG_SUBMITTED");
    expect(submitted).toBeDefined();
    expect(submitted!.link).toBe("/approvals");
  });

  it("does not alert the person who submitted it", async () => {
    const own = await listMyNotifications(employee());
    expect(own.some((n) => n.kind === "DAILY_LOG_SUBMITTED")).toBe(false);
  });
});

describe("the outcome comes back", () => {
  it("tells the employee when their day is approved", async () => {
    await approveLog(manager(), ids.log);

    const alerts = await listMyNotifications(employee());
    const approved = alerts.find((n) => n.kind === "DAILY_LOG_APPROVED");
    expect(approved).toBeDefined();
    expect(approved!.link).toContain("/my-day");
  });

  it("tells the employee when a day is rejected, with the reason", async () => {
    // A fresh day, since the first one is now approved.
    const other = await prisma.venture.create({
      data: { name: `LN2 ${S}`, slug: `ln2-${S}`, timezone: "Asia/Kolkata" },
    });
    await prisma.ventureMembership.createMany({
      data: [
        { ventureId: other.id, personId: ids.empPerson, accessRole: "MEMBER" },
        { ventureId: other.id, personId: ids.mgrPerson, accessRole: "MANAGER" },
      ],
    });

    const today = currentBusinessDate("Asia/Kolkata");
    const empOther: Actor = { ...employee(), memberships: new Map([[other.id, "MEMBER"]]) };
    await saveManualEntry(employeeInVenture(other.id, `LN2 ${S}`, `ln2-${S}`), {
      minutes: 30,
      businessDate: today,
    });
    const days = await getMyDay(empOther, today);
    const log = days.find((d) => d.ventureId === other.id)!;
    await submitLog(empOther, log.id);

    const mgrOther: ActorWithVenture = {
      ...manager(),
      memberships: new Map([[other.id, "MANAGER"]]),
      venture: { ...manager().venture, id: other.id, name: `LN2 ${S}`, slug: `ln2-${S}` },
    };
    await rejectLog(mgrOther, log.id, "Hours look wrong");

    const alerts = await listMyNotifications(employee());
    const rejected = alerts.find((n) => n.kind === "DAILY_LOG_REJECTED");
    expect(rejected).toBeDefined();
    expect(rejected!.body).toContain("Hours look wrong");

    await prisma.timeEntry.deleteMany({ where: { ventureId: other.id } });
    await prisma.dailyLog.deleteMany({ where: { ventureId: other.id } });
    await prisma.ventureMembership.deleteMany({ where: { ventureId: other.id } });
    await prisma.venture.deleteMany({ where: { id: other.id } });
  });

  it("keeps each person's alerts to themselves", async () => {
    const mgrAlerts = await listMyNotifications(manager());
    expect(mgrAlerts.every((n) => n.kind !== "DAILY_LOG_APPROVED")).toBe(true);
  });
});
