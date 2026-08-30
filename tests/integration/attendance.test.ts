import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { testPrisma as prisma } from "../helpers/testPrisma";
import { personPerformance } from "@/modules/reports/report.service";
import type { Actor } from "@/lib/permissions/types";
import { toPrismaDate } from "@/lib/timezone/businessDate";

/**
 * Attendance is measured against the venture's WORKING DAYS, not against how
 * many days someone happened to submit. Dividing by submissions would report
 * 100% for a person who submitted five days out of twenty-one.
 */

const S = `att${Date.now().toString(36)}`;
const ids: Record<string, string> = {};

const admin = (): Actor => ({
  userId: ids.userId,
  personId: ids.personId,
  name: "Admin",
  email: `att-${S}@test.local`,
  globalRole: "SUPER_ADMIN",
  accountStatus: "ACTIVE",
  memberships: new Map(),
});

beforeAll(async () => {
  const venture = await prisma.venture.create({
    data: {
      name: `Att ${S}`,
      slug: `att-${S}`,
      timezone: "Asia/Kolkata",
      workingDays: [1, 2, 3, 4, 5],
    },
  });
  ids.venture = venture.id;

  const user = await prisma.user.create({
    data: {
      name: `Att Person ${S}`,
      email: `att-${S}@test.local`,
      accountStatus: "ACTIVE",
      person: { create: { employmentType: "EMPLOYEE" } },
    },
    include: { person: true },
  });
  ids.userId = user.id;
  ids.personId = user.person!.id;

  await prisma.ventureMembership.create({
    data: { ventureId: venture.id, personId: ids.personId, accessRole: "MEMBER" },
  });

  // Five submitted days in a month that has twenty-one working days.
  for (const day of ["2026-06-01", "2026-06-02", "2026-06-03", "2026-06-04", "2026-06-05"]) {
    await prisma.dailyLog.create({
      data: {
        personId: ids.personId,
        ventureId: venture.id,
        businessDate: toPrismaDate(day),
        status: "APPROVED",
        attendanceStatus: "PRESENT",
        approvedAt: new Date(),
      },
    });
  }
});

afterAll(async () => {
  await prisma.dailyLog.deleteMany({ where: { ventureId: ids.venture } });
  await prisma.ventureMembership.deleteMany({ where: { ventureId: ids.venture } });
  await prisma.person.delete({ where: { id: ids.personId } });
  await prisma.user.delete({ where: { id: ids.userId } });
  await prisma.venture.delete({ where: { id: ids.venture } });
  await prisma.$disconnect();
});

describe("attendance in days", () => {
  it("reports days worked out of the working days in the period", async () => {
    const rows = await personPerformance(admin(), {
      personId: ids.personId,
      from: "2026-06-01",
      to: "2026-06-30",
    });

    const row = rows.find((r) => r.personId === ids.personId)!;

    expect(row.daysWorked).toBe(5);
    // June 2026 has 22 weekdays; the exact figure comes from the calendar.
    expect(row.workingDaysInPeriod).toBeGreaterThan(19);
    expect(row.workingDaysInPeriod).toBeLessThan(24);

    // The whole point: five days out of a full month is NOT 100%.
    expect(row.attendancePercent).not.toBeNull();
    expect(row.attendancePercent!).toBeLessThan(30);
  });

  it("counts remote days as worked", async () => {
    await prisma.dailyLog.create({
      data: {
        personId: ids.personId,
        ventureId: ids.venture,
        businessDate: toPrismaDate("2026-06-08"),
        status: "APPROVED",
        attendanceStatus: "REMOTE",
        approvedAt: new Date(),
      },
    });

    const rows = await personPerformance(admin(), {
      personId: ids.personId,
      from: "2026-06-01",
      to: "2026-06-30",
    });
    const row = rows.find((r) => r.personId === ids.personId)!;

    expect(row.daysRemote).toBe(1);
    expect(row.daysWorked).toBe(6);
  });

  it("omits the working-day count when no date range is given", async () => {
    const rows = await personPerformance(admin(), { personId: ids.personId });
    const row = rows.find((r) => r.personId === ids.personId)!;

    // "Out of how many" is meaningless without a period.
    expect(row.workingDaysInPeriod).toBeNull();
  });
});
