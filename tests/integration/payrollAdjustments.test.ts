import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { testPrisma as prisma } from "../helpers/testPrisma";
import { setAgreement } from "@/modules/compensation/compensation.service";
import {
  createRun,
  generateLines,
  getRun,
  lockRun,
  markLinePaid,
  createAdjustment,
  listAdjustments,
  cancelAdjustment,
  monthPeriod,
} from "@/modules/payroll/payroll.service";
import type { Actor } from "@/lib/permissions/types";
import { isAppError } from "@/lib/errors/appError";
import { toPrismaDate } from "@/lib/timezone/businessDate";

/**
 * Post-payroll corrections (§43).
 *
 * The rule under test: paid payroll is NEVER rewritten. A correction becomes an
 * adjustment that settles forward into the next run, leaving the original
 * snapshot and its audit trail intact.
 */

const S = `adj${Date.now().toString(36)}`;
const ids: Record<string, string> = {};

const admin = (): Actor => ({
  userId: ids.adminUser,
  personId: ids.adminPerson,
  name: "Admin",
  email: `adjadmin-${S}@test.local`,
  globalRole: "SUPER_ADMIN",
  accountStatus: "ACTIVE",
  memberships: new Map(),
});

const manager = (): Actor => ({
  userId: ids.staffUser,
  personId: ids.staffPerson,
  name: "Manager",
  email: `adjstaff-${S}@test.local`,
  globalRole: "USER",
  accountStatus: "ACTIVE",
  memberships: new Map([[ids.venture, "MANAGER"]]),
});

async function makePerson(label: string): Promise<string> {
  const user = await prisma.user.create({
    data: {
      name: `${label} ${S}`,
      email: `adj${label}-${S}@test.local`,
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
    update: { status: "APPROVED" },
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
    data: { name: `Adj ${S}`, slug: `adj-${S}`, timezone: "Asia/Kolkata" },
  });
  ids.venture = venture.id;

  ids.adminPerson = await makePerson("admin");
  ids.staffPerson = await makePerson("staff");

  await prisma.user.update({
    where: { id: ids.adminUser },
    data: { globalRole: "SUPER_ADMIN" },
  });
  await prisma.ventureMembership.create({
    data: { ventureId: venture.id, personId: ids.staffPerson, accessRole: "MEMBER" },
  });

  await setAgreement(admin(), {
    personId: ids.staffPerson,
    payType: "HOURLY",
    currency: "INR",
    rate: 1000,
    effectiveFrom: "2026-01-01",
  });
});

afterAll(async () => {
  const runs = await prisma.payrollRun.findMany({
    where: { notes: { contains: S } },
    select: { id: true },
  });
  const runIds = runs.map((r) => r.id);
  await prisma.payrollAdjustment.deleteMany({
    where: { personId: { in: [ids.staffPerson, ids.adminPerson] } },
  });
  await prisma.payrollLine.deleteMany({ where: { payrollRunId: { in: runIds } } });
  await prisma.payrollRun.deleteMany({ where: { id: { in: runIds } } });
  await prisma.timeEntry.deleteMany({ where: { ventureId: ids.venture } });
  await prisma.dailyLog.deleteMany({ where: { ventureId: ids.venture } });
  await prisma.compensationAgreement.deleteMany({
    where: { personId: { in: [ids.staffPerson, ids.adminPerson] } },
  });
  await prisma.auditLog.deleteMany({ where: { actorUserId: ids.adminUser } });
  await prisma.ventureMembership.deleteMany({ where: { ventureId: ids.venture } });
  await prisma.person.deleteMany({
    where: { id: { in: [ids.staffPerson, ids.adminPerson] } },
  });
  await prisma.user.deleteMany({ where: { email: { contains: S } } });
  await prisma.venture.delete({ where: { id: ids.venture } });
  await prisma.$disconnect();
});

describe("adjustments against paid payroll (§43)", () => {
  it("settles a correction forward instead of rewriting the paid run", async () => {
    // --- January: 10 hours at INR 1,000 = INR 10,000, paid.
    await logApprovedHours(ids.staffPerson, "2026-01-05", 10 * 60);

    const jan = monthPeriod(2026, 1);
    const janRun = await createRun(admin(), {
      periodStart: jan.start,
      periodEnd: jan.end,
      notes: `adj-jan ${S}`,
    });
    await generateLines(admin(), janRun.id);
    await lockRun(admin(), janRun.id);

    let janView = await getRun(admin(), janRun.id);
    const janLine = janView.lines.find((l) => l.personId === ids.staffPerson)!;
    expect(Number(janLine.computedPay)).toBe(10000);

    await markLinePaid(admin(), janLine.id, `REF-${S}`);

    // --- The January amount was short by INR 2,500.
    await createAdjustment(admin(), {
      personId: ids.staffPerson,
      sourcePayrollLineId: janLine.id,
      amount: 2500,
      currency: "INR",
      reason: "Missed overtime approved after the run was locked",
    });

    // The PAID January run must be completely untouched.
    janView = await getRun(admin(), janRun.id);
    const janAfter = janView.lines.find((l) => l.personId === ids.staffPerson)!;
    expect(Number(janAfter.computedPay)).toBe(10000);
    expect(janAfter.paymentStatus).toBe("PAID");

    // --- February: 8 hours = INR 8,000, plus the INR 2,500 settling forward.
    await logApprovedHours(ids.staffPerson, "2026-02-03", 8 * 60);

    const feb = monthPeriod(2026, 2);
    const febRun = await createRun(admin(), {
      periodStart: feb.start,
      periodEnd: feb.end,
      notes: `adj-feb ${S}`,
    });
    await generateLines(admin(), febRun.id);

    const febView = await getRun(admin(), febRun.id);
    const febLine = febView.lines.find((l) => l.personId === ids.staffPerson)!;
    expect(Number(febLine.computedPay)).toBe(10500);

    // ...and the adjustment is now marked settled, so it cannot be paid twice.
    const settled = await listAdjustments(admin(), { personId: ids.staffPerson });
    expect(settled).toHaveLength(1);
    expect(settled[0].settled).toBe(true);
  });

  it("does not settle the same adjustment into a second run", async () => {
    // Regenerating March must not re-apply the already-settled correction.
    await logApprovedHours(ids.staffPerson, "2026-03-02", 5 * 60);

    const mar = monthPeriod(2026, 3);
    const marRun = await createRun(admin(), {
      periodStart: mar.start,
      periodEnd: mar.end,
      notes: `adj-mar ${S}`,
    });
    await generateLines(admin(), marRun.id);

    const marView = await getRun(admin(), marRun.id);
    const marLine = marView.lines.find((l) => l.personId === ids.staffPerson)!;
    // 5h × 1000 = 5,000 exactly — no leftover adjustment.
    expect(Number(marLine.computedPay)).toBe(5000);
  });

  it("supports a negative adjustment to recover an overpayment", async () => {
    await createAdjustment(admin(), {
      personId: ids.staffPerson,
      amount: -1500,
      currency: "INR",
      reason: "Recovering an overpayment made in error",
    });

    await logApprovedHours(ids.staffPerson, "2026-04-06", 4 * 60);
    const apr = monthPeriod(2026, 4);
    const aprRun = await createRun(admin(), {
      periodStart: apr.start,
      periodEnd: apr.end,
      notes: `adj-apr ${S}`,
    });
    await generateLines(admin(), aprRun.id);

    const aprView = await getRun(admin(), aprRun.id);
    const aprLine = aprView.lines.find((l) => l.personId === ids.staffPerson)!;
    // 4h × 1000 = 4,000, less the 1,500 recovered.
    expect(Number(aprLine.computedPay)).toBe(2500);
  });
});

describe("adjustment guard rails", () => {
  it("refuses an adjustment against a line that has not been paid", async () => {
    await logApprovedHours(ids.staffPerson, "2026-05-04", 2 * 60);
    const may = monthPeriod(2026, 5);
    const mayRun = await createRun(admin(), {
      periodStart: may.start,
      periodEnd: may.end,
      notes: `adj-may ${S}`,
    });
    await generateLines(admin(), mayRun.id);
    const mayView = await getRun(admin(), mayRun.id);
    const mayLine = mayView.lines.find((l) => l.personId === ids.staffPerson)!;

    // Unpaid payroll should be voided and regenerated, not adjusted.
    await expect(
      createAdjustment(admin(), {
        personId: ids.staffPerson,
        sourcePayrollLineId: mayLine.id,
        amount: 100,
        currency: "INR",
        reason: "should be refused",
      }),
    ).rejects.toSatisfy((e: unknown) => isAppError(e) && e.code === "CONFLICT");
  });

  it("requires a reason and a non-zero amount", async () => {
    await expect(
      createAdjustment(admin(), {
        personId: ids.staffPerson,
        amount: 0,
        currency: "INR",
        reason: "zero",
      }),
    ).rejects.toSatisfy((e: unknown) => isAppError(e) && e.code === "CONFLICT");

    await expect(
      createAdjustment(admin(), {
        personId: ids.staffPerson,
        amount: 500,
        currency: "INR",
        reason: "   ",
      }),
    ).rejects.toSatisfy((e: unknown) => isAppError(e) && e.code === "CONFLICT");
  });

  it("refuses to cancel an adjustment that has already settled", async () => {
    const settled = await listAdjustments(admin(), { personId: ids.staffPerson });
    const done = settled.find((a) => a.settled);
    expect(done).toBeDefined();

    await expect(
      cancelAdjustment(admin(), done!.id, "changed my mind"),
    ).rejects.toSatisfy((e: unknown) => isAppError(e) && e.code === "CONFLICT");
  });

  it("allows cancelling one that is still outstanding", async () => {
    const created = await createAdjustment(admin(), {
      personId: ids.staffPerson,
      amount: 999,
      currency: "INR",
      reason: "raised by mistake",
    });

    await cancelAdjustment(admin(), created.id, "duplicate entry");

    const remaining = await listAdjustments(admin(), {
      personId: ids.staffPerson,
      outstandingOnly: true,
    });
    expect(remaining.map((a) => a.id)).not.toContain(created.id);
  });

  it("refuses every adjustment operation to a non-admin (§52)", async () => {
    await expect(
      createAdjustment(manager(), {
        personId: ids.staffPerson,
        amount: 5000,
        currency: "INR",
        reason: "unauthorized",
      }),
    ).rejects.toSatisfy((e: unknown) => isAppError(e) && e.code === "FORBIDDEN");

    await expect(listAdjustments(manager())).rejects.toSatisfy(
      (e: unknown) => isAppError(e) && e.code === "FORBIDDEN",
    );
  });

  it("writes an audit record for every adjustment raised", async () => {
    const audit = await prisma.auditLog.findFirst({
      where: { entityType: "PayrollAdjustment", action: "PAYROLL_ADJUSTED" },
      orderBy: { createdAt: "desc" },
    });
    expect(audit).not.toBeNull();
    expect(audit!.actorUserId).toBe(ids.adminUser);
    // The amount is redacted from audit payloads as a pay field (§64).
    expect(audit!.reason).toBeTruthy();
  });
});
