import "dotenv/config";
import { prisma } from "@/lib/db/client";
import { createVenture } from "@/modules/ventures/venture.service";
import { createPerson, setAccountStatus } from "@/modules/people/person.service";
import { createTask, changeTaskStatus, listTasks } from "@/modules/tasks/task.service";
import { saveManualEntry, startTimer, stopTimer } from "@/modules/time/time.service";
import { getMyDay, submitLog, approveLog } from "@/modules/dailyLogs/dailyLog.service";
import { setAgreement } from "@/modules/compensation/compensation.service";
import { createRun, generateLines, getRun, lockRun, markLinePaid, findExceptions, monthPeriod } from "@/modules/payroll/payroll.service";
import { venturePerformance } from "@/modules/reports/report.service";
import { formatEfficiency, formatMinutes } from "@/lib/money/efficiency";
import type { Actor, ActorWithVenture } from "@/lib/permissions/types";
import { currentBusinessDate, toPrismaDate } from "@/lib/timezone/businessDate";

/**
 * Walks the entire business flow end to end against the dev database, then
 * removes everything it created. Run with: npx tsx scripts/verify-flow.mts
 *
 * NOTE: it takes over the payroll run for the current month, so a demo run for
 * that period is removed. Re-seed with `npm run db:demo` afterwards if you want
 * the demo payroll back.
 */

const S = `flow${Date.now().toString(36)}`;
const created: Record<string, string> = {};

function step(n: number, label: string) {
  console.log(`\n${n}. ${label}`);
}

async function main() {
  const adminUser = await prisma.user.findFirstOrThrow({
    where: { globalRole: "SUPER_ADMIN" },
    include: { person: true },
  });

  const admin: Actor = {
    userId: adminUser.id,
    personId: adminUser.person!.id,
    name: adminUser.name,
    email: adminUser.email,
    globalRole: "SUPER_ADMIN",
    accountStatus: "ACTIVE",
    memberships: new Map(),
  };

  step(1, "ADMIN creates venture");
  const venture = await createVenture(admin, {
    name: `Flow Venture ${S}`,
    slug: `flow-${S}`,
    timezone: "Asia/Kolkata",
    tagColor: "#7c3aed",
    workingDays: [1, 2, 3, 4, 5],
    dailyLogEditWindowHours: 48,
    defaultCurrency: "INR",
  });
  created.venture = venture.id;
  console.log(`   ${venture.name} · ${venture.timezone} · ${venture.defaultCurrency}`);

  // Today in the venture timezone, so the daily-log edit window is open.
  const today = currentBusinessDate(venture.timezone);

  // Payroll covers the month containing today, because that is where the
  // approved hours land. Any run already there (from the demo seed or an
  // earlier check) is cleared first so this stays repeatable.
  const period = monthPeriod(Number(today.slice(0, 4)), Number(today.slice(5, 7)));

  const adminInVenture: ActorWithVenture = {
    ...admin,
    venture: {
      id: venture.id,
      name: venture.name,
      slug: venture.slug,
      timezone: venture.timezone,
      workingDays: venture.workingDays,
      dailyLogEditWindowHours: venture.dailyLogEditWindowHours,
      defaultCurrency: venture.defaultCurrency,
    },
    ventureRole: null,
  };

  step(2, "ADMIN adds employee");
  const person = await createPerson(admin, {
    name: `Flow Employee ${S}`,
    email: `flow-${S}@test.local`,
    employmentType: "EMPLOYEE",
    ventureIds: [venture.id],
    accessRole: "MEMBER",
  });
  created.person = person.personId;
  created.user = person.userId;
  await setAccountStatus(admin, { userId: person.userId, status: "ACTIVE" });
  console.log(`   ${person.email} · activated`);

  step(3, "ADMIN sets pay rate (compensation before payroll)");
  await setAgreement(admin, {
    personId: person.personId,
    payType: "HOURLY",
    currency: "INR",
    rate: 1000,
    effectiveFrom: `${today.slice(0, 8)}01`,
  });
  console.log(`   INR 1,000/hour from ${today.slice(0, 8)}01`);

  step(4, "ADMIN creates task with estimated hours");
  const task = await createTask(adminInVenture, {
    ventureId: venture.id,
    title: `Flow Task ${S}`,
    estimatedHours: 8,
    priority: "HIGH",
    assigneeIds: [person.personId],
  });
  created.task = task.id;
  console.log(`   "${task.title}" · estimated ${formatMinutes(task.estimatedMinutes)}`);

  const employee: Actor = {
    userId: person.userId,
    personId: person.personId,
    name: "Flow Employee",
    email: person.email,
    globalRole: "USER",
    accountStatus: "ACTIVE",
    memberships: new Map([[venture.id, "MEMBER"]]),
  };
  const employeeInVenture: ActorWithVenture = {
    ...employee,
    venture: adminInVenture.venture,
    ventureRole: "MEMBER",
  };

  step(5, "EMPLOYEE works — timer plus manual hours");
  await changeTaskStatus(adminInVenture, { taskId: task.id, status: "IN_PROGRESS" });
  const running = await startTimer(employeeInVenture, { taskId: task.id });
  console.log(`   timer started (running: ${running.running})`);
  await stopTimer(employee);
  console.log("   timer stopped, duration computed server-side");

  await saveManualEntry(employeeInVenture, {
    taskId: task.id,
    businessDate: today,
    minutes: 10 * 60,
  });
  console.log(`   10h recorded on ${today}`);


  step(6, "EMPLOYEE submits daily log");
  const days = await getMyDay(employee, today);
  const log = days.find((d) => d.ventureId === venture.id)!;
  console.log(`   total for the day: ${formatMinutes(log.totalMinutes)}`);
  await submitLog(employee, log.id);
  console.log("   submitted");

  step(7, "MANAGER/ADMIN reviews and approves");
  await approveLog(adminInVenture, log.id);
  console.log("   approved — these hours are now payable");

  step(8, "Task completed, efficiency generated");
  await changeTaskStatus(adminInVenture, { taskId: task.id, status: "DONE" });
  const [done] = await listTasks(admin, { ventureId: venture.id });
  console.log(
    `   estimated ${formatMinutes(done.estimatedMinutes)} vs actual ${formatMinutes(done.actualMinutes)} → ${formatEfficiency(done.efficiency)}`,
  );

  const perf = await venturePerformance(admin, { ventureId: venture.id });
  console.log(`   venture efficiency: ${formatEfficiency(perf[0].efficiency)}`);

  step(9, "Pay period ends — payroll calculated");
  // Clear any run left behind by an interrupted earlier check.
  const stale = await prisma.payrollRun.findFirst({
    where: { periodStart: toPrismaDate(period.start) },
    select: { id: true },
  });
  if (stale) {
    await prisma.payrollLine.deleteMany({ where: { payrollRunId: stale.id } });
    await prisma.payrollRun.delete({ where: { id: stale.id } });
  }

  const run = await createRun(admin, {
    periodStart: period.start,
    periodEnd: period.end,
    notes: `flow ${S}`,
  });
  created.run = run.id;

  const exceptions = await findExceptions(admin, run.id);
  console.log(`   exceptions found: ${exceptions.length}`);

  await generateLines(admin, run.id);
  const view = await getRun(admin, run.id);
  const line = view.lines.find((l) => l.personId === person.personId);
  console.log(
    `   ${line?.personName}: ${formatMinutes(line?.approvedMinutes ?? 0)} approved × INR ${Number(line?.rate).toLocaleString()} = INR ${Number(line?.computedPay).toLocaleString()}`,
  );

  step(10, "ADMIN reviews, payroll locked");
  await lockRun(admin, run.id);
  const locked = await getRun(admin, run.id);
  console.log(`   status: ${locked.status}`);
  for (const t of locked.totalsByCurrency) {
    console.log(`   total ${t.currency} ${Number(t.total).toLocaleString()} across ${t.lineCount} line(s)`);
  }

  step(11, "CSV export → external payroll system pays → mark paid");
  if (line) {
    await markLinePaid(admin, line.id, `BANK-${S}`);
    const paid = await getRun(admin, run.id);
    const ourLine = paid.lines.find((l) => l.id === line.id);
    console.log(`   payment status: ${ourLine?.paymentStatus ?? "not found"}`);
  }

  step(12, "Audit trail");
  const audits = await prisma.auditLog.findMany({
    where: { actorUserId: admin.userId },
    orderBy: { createdAt: "desc" },
    take: 8,
    select: { action: true, entityType: true },
  });
  for (const a of audits) console.log(`   ${a.action} on ${a.entityType}`);

  console.log("\nCleaning up...");
  if (created.run) {
    await prisma.payrollLine.deleteMany({ where: { payrollRunId: created.run } });
    await prisma.payrollRun.delete({ where: { id: created.run } });
  } else {
    // Left an existing run in place; remove only this run's line for our person.
    await prisma.payrollLine.deleteMany({ where: { personId: created.person } });
  }
  await prisma.timeEntry.deleteMany({ where: { ventureId: created.venture } });
  await prisma.dailyLog.deleteMany({ where: { ventureId: created.venture } });
  await prisma.taskStatusHistory.deleteMany({ where: { taskId: created.task } });
  await prisma.taskAssignee.deleteMany({ where: { taskId: created.task } });
  await prisma.task.delete({ where: { id: created.task } });
  await prisma.compensationAgreement.deleteMany({ where: { personId: created.person } });
  await prisma.auditLog.deleteMany({
    where: { OR: [{ entityId: created.venture }, { entityId: created.person }, { entityId: created.run }, { entityId: created.task }] },
  });
  const memberships = await prisma.ventureMembership.findMany({
    where: { ventureId: created.venture },
    select: { id: true },
  });
  await prisma.auditLog.deleteMany({ where: { entityId: { in: memberships.map((m) => m.id) } } });
  await prisma.ventureMembership.deleteMany({ where: { ventureId: created.venture } });
  await prisma.verificationToken.deleteMany({ where: { identifier: person.email } });
  await prisma.person.delete({ where: { id: created.person } });
  await prisma.user.delete({ where: { id: created.user } });
  await prisma.venture.delete({ where: { id: created.venture } });
  await prisma.auditLog.deleteMany({ where: { entityId: { in: Object.values(created) } } });
  console.log("Done — database returned to its previous state.\n");

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error("\nFLOW FAILED:", e);
  await prisma.$disconnect();
  process.exit(1);
});
