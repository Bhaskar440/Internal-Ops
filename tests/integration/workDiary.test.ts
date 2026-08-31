import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { testPrisma as prisma } from "../helpers/testPrisma";
import { workDiary, listPendingApprovals, countPendingApprovals } from "@/modules/dailyLogs/dailyLog.service";
import { saveManualEntry } from "@/modules/time/time.service";
import { currentBusinessDate, toPrismaDate } from "@/lib/timezone/businessDate";
import type { Actor, ActorWithVenture } from "@/lib/permissions/types";
import { isAppError } from "@/lib/errors/appError";

/**
 * The written record of work, and who may read it (§33).
 *
 * Two rules under test: an entry has to say what was done, and only an
 * administrator may read across people and weeks at once.
 */

const S = `wd${Date.now().toString(36)}`;
const ids: Record<string, string> = {};

function personActor(
  userKey: string,
  personKey: string,
  role: "MANAGER" | "MEMBER",
  globalRole: "SUPER_ADMIN" | "USER" = "USER",
): ActorWithVenture {
  const base: Actor = {
    userId: ids[userKey],
    personId: ids[personKey],
    name: personKey,
    email: `${personKey}-${S}@test.local`,
    globalRole,
    accountStatus: "ACTIVE",
    memberships: new Map([[ids.venture, role]]),
  };
  return {
    ...base,
    venture: {
      id: ids.venture,
      name: `WD ${S}`,
      slug: `wd-${S}`,
      timezone: "Asia/Kolkata",
      workingDays: [1, 2, 3, 4, 5],
      dailyLogEditWindowHours: 48,
      defaultCurrency: "INR",
    },
    ventureRole: role,
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

beforeAll(async () => {
  const venture = await prisma.venture.create({
    data: { name: `WD ${S}`, slug: `wd-${S}`, timezone: "Asia/Kolkata" },
  });
  ids.venture = venture.id;

  const emp = await makePerson("emp", "MEMBER");
  ids.empUser = emp.userId;
  ids.empPerson = emp.personId;

  const mgr = await makePerson("mgr", "MANAGER");
  ids.mgrUser = mgr.userId;
  ids.mgrPerson = mgr.personId;

  const adm = await makePerson("adm", "MANAGER");
  ids.admUser = adm.userId;
  ids.admPerson = adm.personId;
  await prisma.user.update({
    where: { id: ids.admUser },
    data: { globalRole: "SUPER_ADMIN" },
  });
});

afterAll(async () => {
  await prisma.notification.deleteMany({
    where: { personId: { in: [ids.empPerson, ids.mgrPerson, ids.admPerson] } },
  });
  await prisma.timeEntry.deleteMany({ where: { ventureId: ids.venture } });
  await prisma.dailyLog.deleteMany({ where: { ventureId: ids.venture } });
  await prisma.ventureMembership.deleteMany({ where: { ventureId: ids.venture } });
  await prisma.person.deleteMany({ where: { user: { email: { contains: S } } } });
  await prisma.user.deleteMany({ where: { email: { contains: S } } });
  await prisma.venture.deleteMany({ where: { id: ids.venture } });
});

describe("an entry must say what was done", () => {
  it("refuses an entry with no description", async () => {
    await expect(
      saveManualEntry(personActor("empUser", "empPerson", "MEMBER"), {
        businessDate: currentBusinessDate("Asia/Kolkata"),
        minutes: 60,
      }),
    ).rejects.toSatisfy((e) => isAppError(e) && e.code === "CONFLICT");
  });

  it("refuses a description of only whitespace", async () => {
    await expect(
      saveManualEntry(personActor("empUser", "empPerson", "MEMBER"), {
        businessDate: currentBusinessDate("Asia/Kolkata"),
        minutes: 60,
        note: "   ",
      }),
    ).rejects.toSatisfy((e) => isAppError(e) && e.code === "CONFLICT");
  });

  it("stores a real description, trimmed", async () => {
    const entry = await saveManualEntry(personActor("empUser", "empPerson", "MEMBER"), {
      businessDate: currentBusinessDate("Asia/Kolkata"),
      minutes: 90,
      note: "  Rewrote the pricing comparison table  ",
    });
    expect(entry.note).toBe("Rewrote the pricing comparison table");
  });
});

describe("a manager's own day escalates", () => {
  it("does not appear in that manager's own approval queue", async () => {
    const today = currentBusinessDate("Asia/Kolkata");
    await saveManualEntry(personActor("mgrUser", "mgrPerson", "MANAGER"), {
      businessDate: today,
      minutes: 120,
      note: "Reviewed the quarter plan",
    });

    const log = await prisma.dailyLog.findFirst({
      where: { personId: ids.mgrPerson, businessDate: toPrismaDate(today) },
    });
    await prisma.dailyLog.update({
      where: { id: log!.id },
      data: { status: "SUBMITTED", submittedAt: new Date() },
    });

    const queue = await listPendingApprovals(personActor("mgrUser", "mgrPerson", "MANAGER"));
    // A row they are forbidden from approving would only clutter the queue.
    expect(queue.some((l) => l.personId === ids.mgrPerson)).toBe(false);
  });

  it("appears in the Super Admin's queue instead", async () => {
    const queue = await listPendingApprovals(
      personActor("admUser", "admPerson", "MANAGER", "SUPER_ADMIN"),
    );
    expect(queue.some((l) => l.personId === ids.mgrPerson)).toBe(true);
  });

  it("counts the same rows the queue lists", async () => {
    const mgr = personActor("mgrUser", "mgrPerson", "MANAGER");
    const [count, list] = await Promise.all([
      countPendingApprovals(mgr),
      listPendingApprovals(mgr),
    ]);
    // A badge promising rows the queue does not show is worse than no badge.
    expect(count).toBe(list.length);
  });
});

describe("the work diary is administrators only", () => {
  const range = () => {
    const today = currentBusinessDate("Asia/Kolkata");
    const from = new Date(`${today}T12:00:00Z`);
    from.setUTCDate(from.getUTCDate() - 7);
    return { from: from.toISOString().slice(0, 10), to: today };
  };

  it("refuses a plain member", async () => {
    await expect(
      workDiary(personActor("empUser", "empPerson", "MEMBER"), range()),
    ).rejects.toSatisfy((e) => isAppError(e) && e.code === "FORBIDDEN");
  });

  it("refuses a manager, who can still approve their own venture's days", async () => {
    await expect(
      workDiary(personActor("mgrUser", "mgrPerson", "MANAGER"), range()),
    ).rejects.toSatisfy((e) => isAppError(e) && e.code === "FORBIDDEN");
  });

  it("gives an administrator the written record", async () => {
    const days = await workDiary(
      personActor("admUser", "admPerson", "MANAGER", "SUPER_ADMIN"),
      range(),
    );
    const mine = days.find((d) => d.personId === ids.empPerson);
    expect(mine).toBeDefined();
    expect(mine!.entries.some((e) => e.description?.includes("pricing comparison"))).toBe(true);
  });

  it("can narrow to one person", async () => {
    const days = await workDiary(
      personActor("admUser", "admPerson", "MANAGER", "SUPER_ADMIN"),
      { ...range(), personId: ids.mgrPerson },
    );
    expect(days.length).toBeGreaterThan(0);
    expect(days.every((d) => d.personId === ids.mgrPerson)).toBe(true);
  });
});
