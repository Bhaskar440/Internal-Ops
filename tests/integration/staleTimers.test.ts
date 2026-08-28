import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { testPrisma as prisma } from "../helpers/testPrisma";
import { autoStopStaleTimers } from "@/modules/time/time.service";
import { toPrismaDate, currentBusinessDate } from "@/lib/timezone/businessDate";

/**
 * Abandoned timers.
 *
 * A timer left running overnight would otherwise bill 15+ hours. The rule is
 * that the true elapsed time is recorded and flagged for review — never
 * truncated, never discarded — because these hours feed payroll.
 */

const S = `stale${Date.now().toString(36)}`;
const ids: Record<string, string> = {};

beforeAll(async () => {
  const venture = await prisma.venture.create({
    data: { name: `Stale ${S}`, slug: `stale-${S}`, timezone: "Asia/Kolkata" },
  });
  ids.venture = venture.id;

  const user = await prisma.user.create({
    data: {
      name: "Forgetful Employee",
      email: `stale-${S}@test.local`,
      accountStatus: "ACTIVE",
      person: { create: { employmentType: "EMPLOYEE" } },
    },
    include: { person: true },
  });
  ids.user = user.id;
  ids.person = user.person!.id;

  await prisma.ventureMembership.create({
    data: { ventureId: venture.id, personId: ids.person, accessRole: "MEMBER" },
  });
});

afterAll(async () => {
  await prisma.timeEntry.deleteMany({ where: { ventureId: ids.venture } });
  await prisma.dailyLog.deleteMany({ where: { ventureId: ids.venture } });
  await prisma.ventureMembership.deleteMany({ where: { ventureId: ids.venture } });
  await prisma.person.delete({ where: { id: ids.person } });
  await prisma.user.delete({ where: { id: ids.user } });
  await prisma.venture.delete({ where: { id: ids.venture } });
  await prisma.$disconnect();
});

describe("abandoned timer cleanup", () => {
  it("stops a timer running past the threshold and flags it for review", async () => {
    const startedAt = new Date(Date.now() - 30 * 3600 * 1000); // 30 hours ago

    const entry = await prisma.timeEntry.create({
      data: {
        personId: ids.person,
        ventureId: ids.venture,
        source: "TIMER",
        startedAt,
        endedAt: null,
        businessDate: toPrismaDate(currentBusinessDate("Asia/Kolkata", startedAt)),
      },
      select: { id: true },
    });

    const stopped = await autoStopStaleTimers();
    expect(stopped).toBeGreaterThanOrEqual(1);

    const after = await prisma.timeEntry.findUniqueOrThrow({
      where: { id: entry.id },
      select: { endedAt: true, durationSeconds: true, approvalStatus: true, note: true },
    });

    expect(after.endedAt).not.toBeNull();
    // The true elapsed time is kept — roughly 30 hours, not truncated to 24.
    expect(after.durationSeconds).toBeGreaterThan(29 * 3600);
    // ...and it is flagged so a manager confirms before it is paid.
    expect(after.approvalStatus).toBe("NEEDS_REVIEW");
    expect(after.note).toMatch(/auto-stopped/i);
  });

  it("leaves a recently started timer alone", async () => {
    const startedAt = new Date(Date.now() - 60 * 1000); // a minute ago

    const entry = await prisma.timeEntry.create({
      data: {
        personId: ids.person,
        ventureId: ids.venture,
        source: "TIMER",
        startedAt,
        endedAt: null,
        businessDate: toPrismaDate(currentBusinessDate("Asia/Kolkata", startedAt)),
      },
      select: { id: true },
    });

    await autoStopStaleTimers();

    const after = await prisma.timeEntry.findUniqueOrThrow({
      where: { id: entry.id },
      select: { endedAt: true },
    });
    expect(after.endedAt).toBeNull();

    await prisma.timeEntry.delete({ where: { id: entry.id } });
  });
});
