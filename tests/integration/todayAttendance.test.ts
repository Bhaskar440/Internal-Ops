import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { testPrisma as prisma } from "../helpers/testPrisma";
import { todayAttendanceByPerson } from "@/modules/reports/report.service";
import { currentBusinessDate, toPrismaDate } from "@/lib/timezone/businessDate";
import type { Actor } from "@/lib/permissions/types";

/**
 * Today's attendance, per person (§9).
 *
 * The distinction that matters: an account being ACTIVE says someone can sign
 * in, not that they are working. A person with no log today is "not submitted",
 * which is different from being marked absent.
 */

const S = `att${Date.now().toString(36)}`;
const ids: Record<string, string> = {};

function admin(): Actor {
  return {
    userId: ids.adminUser,
    personId: ids.adminPerson,
    name: "Admin",
    email: `admin-${S}@test.local`,
    globalRole: "SUPER_ADMIN",
    accountStatus: "ACTIVE",
    memberships: new Map([[ids.venture, "MANAGER"]]),
  };
}

async function makePerson(label: string) {
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
    data: { ventureId: ids.venture, personId: user.person!.id, accessRole: "MEMBER" },
  });
  return { userId: user.id, personId: user.person!.id };
}

beforeAll(async () => {
  const venture = await prisma.venture.create({
    data: { name: `ATT ${S}`, slug: `att-${S}`, timezone: "Asia/Kolkata" },
  });
  ids.venture = venture.id;

  const a = await makePerson("adm");
  ids.adminUser = a.userId;
  ids.adminPerson = a.personId;
  await prisma.user.update({
    where: { id: ids.adminUser },
    data: { globalRole: "SUPER_ADMIN" },
  });

  const present = await makePerson("present");
  ids.presentPerson = present.personId;

  const leave = await makePerson("leave");
  ids.leavePerson = leave.personId;

  // Someone with no log at all today.
  const silent = await makePerson("silent");
  ids.silentPerson = silent.personId;

  const today = toPrismaDate(currentBusinessDate("Asia/Kolkata"));
  await prisma.dailyLog.create({
    data: {
      personId: ids.presentPerson,
      ventureId: ids.venture,
      businessDate: today,
      attendanceStatus: "PRESENT",
      status: "SUBMITTED",
    },
  });
  await prisma.dailyLog.create({
    data: {
      personId: ids.leavePerson,
      ventureId: ids.venture,
      businessDate: today,
      attendanceStatus: "ON_LEAVE",
      status: "DRAFT",
    },
  });
});

afterAll(async () => {
  await prisma.dailyLog.deleteMany({ where: { ventureId: ids.venture } });
  await prisma.ventureMembership.deleteMany({ where: { ventureId: ids.venture } });
  await prisma.person.deleteMany({ where: { user: { email: { contains: S } } } });
  await prisma.user.deleteMany({ where: { email: { contains: S } } });
  await prisma.venture.deleteMany({ where: { id: ids.venture } });
});

describe("today's attendance per person", () => {
  it("reports the submitted status", async () => {
    const map = await todayAttendanceByPerson(admin());
    expect(map.get(ids.presentPerson)).toEqual({ status: "PRESENT", submitted: true });
  });

  it("marks a day that exists but has not been submitted", async () => {
    const map = await todayAttendanceByPerson(admin());
    expect(map.get(ids.leavePerson)).toEqual({ status: "ON_LEAVE", submitted: false });
  });

  it("returns nothing for someone who has not filled the day in", async () => {
    const map = await todayAttendanceByPerson(admin());
    // Absent is a statement; no entry is the absence of one.
    expect(map.get(ids.silentPerson)).toBeUndefined();
  });

  it("is empty for an actor scoped to no ventures", async () => {
    const nobody: Actor = { ...admin(), globalRole: "USER", memberships: new Map() };
    const map = await todayAttendanceByPerson(nobody);
    expect(map.size).toBe(0);
  });
});
