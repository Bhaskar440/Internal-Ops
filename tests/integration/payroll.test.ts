import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { testPrisma as prisma } from "../helpers/testPrisma";
import { setAgreement, agreementOn, listAgreements } from "@/modules/compensation/compensation.service";
import {
  createRun,
  generateLines,
  getRun,
  lockRun,
  voidRun,
  markLinePaid,
  findExceptions,
  monthPeriod,
} from "@/modules/payroll/payroll.service";
import type { Actor } from "@/lib/permissions/types";
import { isAppError } from "@/lib/errors/appError";
import { toPrismaDate } from "@/lib/timezone/businessDate";

/**
 * Payroll and compensation.
 *
 * This is money, so the arithmetic is checked against the spec's own worked
 * examples, and the history rules are exercised directly: a rate change must
 * never alter a run that already used the old rate.
 */

const S = `pay${Date.now().toString(36)}`;
const ids: Record<string, string> = {};

const admin = (): Actor => ({
  userId: ids.adminUser,
  personId: ids.adminPerson,
  name: "Admin",
  email: `admin-${S}@test.local`,
  globalRole: "SUPER_ADMIN",
  accountStatus: "ACTIVE",
  memberships: new Map(),
});

const nonAdmin = (): Actor => ({
  userId: ids.empUser,
  personId: ids.hourlyPerson,
  name: "Employee",
  email: `hourly-${S}@test.local`,
  globalRole: "USER",
  accountStatus: "ACTIVE",
  memberships: new Map([[ids.venture, "MANAGER"]]),
});

async function makePerson(label: string): Promise<string> {
  const user = await prisma.user.create({
    data: {
      name: `${label} ${S}`,
      email: `${label}-${S}@test.local`,
      accountStatus: "ACTIVE",
      person: { create: { employmentType: "EMPLOYEE" } },
    },
    include: { person: true },
  });
  ids[`${label}User`] = user.id;
  return user.person!.id;
}

/** Approved hours on a date — the only hours payroll pays. */
async function logApprovedHours(personId: string, date: string, minutes: number) {
  const log = await prisma.dailyLog.upsert({
    where: {
      personId_ventureId_businessDate: {
        personId,
        ventureId: ids.venture,
        businessDate: toPrismaDate(date),
      },
    },
    update: { status: "APPROVED", attendanceStatus: "PRESENT" },
    create: {
      personId,
      ventureId: ids.venture,
      businessDate: toPrismaDate(date),
      status: "APPROVED",
      attendanceStatus: "PRESENT",
      approvedAt: new Date(),
    },
    select: { id: true },
  });

  await prisma.timeEntry.create({
    data: {
      personId,
      ventureId: ids.venture,
      dailyLogId: log.id,
      source: "MANUAL",
      startedAt: new Date(`${date}T09:00:00Z`),
      endedAt: new Date(`${date}T09:00:00Z`),
      durationSeconds: minutes * 60,
      businessDate: toPrismaDate(date),
      approvalStatus: "APPROVED",
    },
  });
}

beforeAll(async () => {
  const venture = await prisma.venture.create({
    data: { name: `Pay ${S}`, slug: `pay-${S}`, timezone: "Asia/Kolkata" },
  });
  ids.venture = venture.id;

  ids.adminPerson = await makePerson("admin");
  ids.hourlyPerson = await makePerson("hourly");
  ids.monthlyPerson = await makePerson("monthly");
  ids.empUser = ids.hourlyUser;

  await prisma.user.update({
    where: { id: ids.adminUser },
    data: { globalRole: "SUPER_ADMIN" },
  });

  await prisma.ventureMembership.createMany({
    data: [
      { ventureId: venture.id, personId: ids.hourlyPerson, accessRole: "MEMBER" },
      { ventureId: venture.id, personId: ids.monthlyPerson, accessRole: "MEMBER" },
    ],
  });
});

afterAll(async () => {
  const runs = await prisma.payrollRun.findMany({
    where: { notes: { contains: S } },
    select: { id: true },
  });
  const runIds = runs.map((r) => r.id);
  await prisma.payrollLine.deleteMany({ where: { payrollRunId: { in: runIds } } });
  await prisma.payrollRun.deleteMany({ where: { id: { in: runIds } } });

  await prisma.timeEntry.deleteMany({ where: { ventureId: ids.venture } });
  await prisma.dailyLog.deleteMany({ where: { ventureId: ids.venture } });
  await prisma.compensationAgreement.deleteMany({
    where: { personId: { in: [ids.hourlyPerson, ids.monthlyPerson, ids.adminPerson] } },
  });
  await prisma.auditLog.deleteMany({ where: { actorUserId: ids.adminUser } });
  await prisma.ventureMembership.deleteMany({ where: { ventureId: ids.venture } });
  await prisma.person.deleteMany({
    where: { id: { in: [ids.hourlyPerson, ids.monthlyPerson, ids.adminPerson] } },
  });
  await prisma.user.deleteMany({ where: { email: { contains: S } } });
  await prisma.venture.delete({ where: { id: ids.venture } });
  await prisma.$disconnect();
});

describe("compensation history (§35)", () => {
  it("closes the previous agreement instead of overwriting the rate", async () => {
    // The spec's example: 800/hour Jan-Jun, then 1000/hour from July.
    await setAgreement(admin(), {
      personId: ids.hourlyPerson,
      payType: "HOURLY",
      currency: "INR",
      rate: 800,
      effectiveFrom: "2026-01-01",
    });
    await setAgreement(admin(), {
      personId: ids.hourlyPerson,
      payType: "HOURLY",
      currency: "INR",
      rate: 1000,
      effectiveFrom: "2026-07-01",
    });

    const history = await listAgreements(admin(), ids.hourlyPerson);
    expect(history).toHaveLength(2);

    // A June payroll must still see the old rate.
    const june = await agreementOn(ids.hourlyPerson, "2026-06-15");
    expect(Number(june!.rate)).toBe(800);

    // August sees the new one.
    const august = await agreementOn(ids.hourlyPerson, "2026-08-15");
    expect(Number(august!.rate)).toBe(1000);
  });

  it("refuses to disclose or change pay for a non-admin (§52)", async () => {
    await expect(listAgreements(nonAdmin(), ids.hourlyPerson)).rejects.toSatisfy(
      (e: unknown) => isAppError(e) && e.code === "FORBIDDEN",
    );

    await expect(
      setAgreement(nonAdmin(), {
        personId: ids.hourlyPerson,
        payType: "HOURLY",
        currency: "INR",
        rate: 99999,
        effectiveFrom: "2026-08-01",
      }),
    ).rejects.toSatisfy((e: unknown) => isAppError(e) && e.code === "FORBIDDEN");
  });
});

describe("payroll calculation (§37, §38)", () => {
  it("pays hourly work as approved hours times the effective rate", async () => {
    // 62 hours at INR 1,000 = INR 62,000, the spec's worked example.
    await logApprovedHours(ids.hourlyPerson, "2026-08-03", 8 * 60);
    await logApprovedHours(ids.hourlyPerson, "2026-08-04", 8 * 60);
    await logApprovedHours(ids.hourlyPerson, "2026-08-05", 8 * 60);
    await logApprovedHours(ids.hourlyPerson, "2026-08-06", 8 * 60);
    await logApprovedHours(ids.hourlyPerson, "2026-08-07", 8 * 60);
    await logApprovedHours(ids.hourlyPerson, "2026-08-10", 8 * 60);
    await logApprovedHours(ids.hourlyPerson, "2026-08-11", 8 * 60);
    await logApprovedHours(ids.hourlyPerson, "2026-08-12", 6 * 60);

    const period = monthPeriod(2026, 8);
    const run = await createRun(admin(), {
      periodStart: period.start,
      periodEnd: period.end,
      notes: `test ${S}`,
    });

    await generateLines(admin(), run.id);
    const view = await getRun(admin(), run.id);

    const line = view.lines.find((l) => l.personId === ids.hourlyPerson);
    expect(line).toBeDefined();
    expect(line!.approvedMinutes).toBe(62 * 60);
    expect(line!.currency).toBe("INR");
    expect(Number(line!.computedPay)).toBe(62000);
    // The rate used is snapshotted onto the line, not read live.
    expect(Number(line!.rate)).toBe(1000);
  });

  it("pays a fixed monthly salary in full under the default policy", async () => {
    await setAgreement(admin(), {
      personId: ids.monthlyPerson,
      payType: "MONTHLY_FIXED",
      currency: "INR",
      rate: 90000,
      effectiveFrom: "2026-01-01",
      prorationPolicy: "FIXED_FULL",
    });
    await logApprovedHours(ids.monthlyPerson, "2026-08-03", 8 * 60);

    const period = monthPeriod(2026, 8);
    const run = await prisma.payrollRun.findFirstOrThrow({
      where: { periodStart: toPrismaDate(period.start) },
      select: { id: true },
    });

    await generateLines(admin(), run.id);
    const view = await getRun(admin(), run.id);

    const line = view.lines.find((l) => l.personId === ids.monthlyPerson);
    expect(Number(line!.computedPay)).toBe(90000);
  });

  it("keeps currency totals separate rather than adding them (§36)", async () => {
    const period = monthPeriod(2026, 8);
    const run = await prisma.payrollRun.findFirstOrThrow({
      where: { periodStart: toPrismaDate(period.start) },
      select: { id: true },
    });
    const view = await getRun(admin(), run.id);

    expect(view.totalsByCurrency.length).toBeGreaterThan(0);
    for (const total of view.totalsByCurrency) {
      expect(total.currency).toMatch(/^[A-Z]{3}$/);
    }
    const inr = view.totalsByCurrency.find((t) => t.currency === "INR");
    // 62,000 hourly + 90,000 monthly
    expect(Number(inr!.total)).toBe(152000);
  });
});

describe("payroll snapshot is immutable (§42)", () => {
  it("does not change a locked run when the rate later changes", async () => {
    const period = monthPeriod(2026, 8);
    const run = await prisma.payrollRun.findFirstOrThrow({
      where: { periodStart: toPrismaDate(period.start) },
      select: { id: true },
    });

    await lockRun(admin(), run.id);
    const before = await getRun(admin(), run.id);
    const payBefore = before.lines.find((l) => l.personId === ids.hourlyPerson)!.computedPay;

    // A big raise, effective inside the already-locked period.
    await setAgreement(admin(), {
      personId: ids.hourlyPerson,
      payType: "HOURLY",
      currency: "INR",
      rate: 5000,
      effectiveFrom: "2026-08-01",
    });

    const after = await getRun(admin(), run.id);
    const payAfter = after.lines.find((l) => l.personId === ids.hourlyPerson)!.computedPay;

    expect(payAfter).toBe(payBefore);
    expect(after.status).toBe("LOCKED");
  });

  it("refuses to recalculate a locked run", async () => {
    const period = monthPeriod(2026, 8);
    const run = await prisma.payrollRun.findFirstOrThrow({
      where: { periodStart: toPrismaDate(period.start) },
      select: { id: true },
    });

    await expect(generateLines(admin(), run.id)).rejects.toSatisfy(
      (e: unknown) => isAppError(e) && e.code === "CONFLICT",
    );
  });

  it("marks a line paid and records who did it", async () => {
    const period = monthPeriod(2026, 8);
    const run = await prisma.payrollRun.findFirstOrThrow({
      where: { periodStart: toPrismaDate(period.start) },
      select: { id: true },
    });
    const view = await getRun(admin(), run.id);
    const line = view.lines[0];

    await markLinePaid(admin(), line.id, `REF-${S}`);

    const after = await getRun(admin(), run.id);
    const paid = after.lines.find((l) => l.id === line.id)!;
    expect(paid.paymentStatus).toBe("PAID");
    expect(paid.paidAt).not.toBeNull();

    const audit = await prisma.auditLog.findFirst({
      where: { entityType: "PayrollLine", entityId: line.id, action: "PAYROLL_MARKED_PAID" },
    });
    expect(audit).not.toBeNull();
  });

  it("refuses to void a run that has paid lines (§43)", async () => {
    const period = monthPeriod(2026, 8);
    const run = await prisma.payrollRun.findFirstOrThrow({
      where: { periodStart: toPrismaDate(period.start) },
      select: { id: true },
    });

    await expect(voidRun(admin(), run.id, "changed my mind")).rejects.toSatisfy(
      (e: unknown) => isAppError(e) && e.code === "CONFLICT",
    );
  });
});

describe("payroll access control (§52)", () => {
  it("refuses every payroll operation to a non-admin, including a manager", async () => {
    const period = monthPeriod(2026, 9);

    await expect(
      createRun(nonAdmin(), { periodStart: period.start, periodEnd: period.end }),
    ).rejects.toSatisfy((e: unknown) => isAppError(e) && e.code === "FORBIDDEN");

    const run = await prisma.payrollRun.findFirstOrThrow({
      where: { periodStart: toPrismaDate(monthPeriod(2026, 8).start) },
      select: { id: true },
    });

    await expect(getRun(nonAdmin(), run.id)).rejects.toSatisfy(
      (e: unknown) => isAppError(e) && e.code === "FORBIDDEN",
    );
    await expect(lockRun(nonAdmin(), run.id)).rejects.toSatisfy(
      (e: unknown) => isAppError(e) && e.code === "FORBIDDEN",
    );
    await expect(findExceptions(nonAdmin(), run.id)).rejects.toSatisfy(
      (e: unknown) => isAppError(e) && e.code === "FORBIDDEN",
    );
  });
});

describe("payroll exceptions (§44)", () => {
  it("flags people with no compensation agreement", async () => {
    const orphan = await makePerson("orphan");
    await prisma.ventureMembership.create({
      data: { ventureId: ids.venture, personId: orphan, accessRole: "MEMBER" },
    });

    const period = monthPeriod(2026, 10);
    const run = await createRun(admin(), {
      periodStart: period.start,
      periodEnd: period.end,
      notes: `exceptions ${S}`,
    });

    const exceptions = await findExceptions(admin(), run.id);
    const missing = exceptions.find(
      (e) => e.personId === orphan && e.type === "MISSING_PAY_RATE",
    );
    expect(missing).toBeDefined();

    // The exception must not carry any pay information.
    expect(JSON.stringify(exceptions)).not.toMatch(/rate":\s*\d/);

    await prisma.ventureMembership.deleteMany({ where: { personId: orphan } });
    await prisma.person.delete({ where: { id: orphan } });
    await prisma.user.delete({ where: { id: ids.orphanUser } });
  });
});
