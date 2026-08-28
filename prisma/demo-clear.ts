import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

/**
 * Remove everything the demo seed created, and nothing else.
 *
 * People are matched by their demo email domain, and the rows they own are
 * removed in dependency order. Real records have no demo marker, so they are
 * never touched.
 */

const DEMO_MARKER = "demo.portfolioops.local";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is not set.");
if (!/localhost|127\.0\.0\.1/.test(connectionString)) {
  throw new Error("Refusing to run against a non-local database.");
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

async function main() {
  console.log("Removing demo data...\n");

  const users = await prisma.user.findMany({
    where: { email: { endsWith: DEMO_MARKER } },
    include: { person: true },
  });
  const personIds = users.map((u) => u.person?.id).filter((v): v is string => Boolean(v));

  // Tasks created for the demo, identified by their description marker.
  const tasks = await prisma.task.findMany({
    where: { description: { contains: "Demo task in" } },
    select: { id: true },
  });
  const taskIds = tasks.map((t) => t.id);

  await prisma.timeEntry.deleteMany({
    where: { OR: [{ personId: { in: personIds } }, { taskId: { in: taskIds } }] },
  });
  await prisma.taskStatusHistory.deleteMany({ where: { taskId: { in: taskIds } } });
  await prisma.taskAssignee.deleteMany({ where: { taskId: { in: taskIds } } });
  await prisma.task.deleteMany({ where: { id: { in: taskIds } } });
  await prisma.dailyLog.deleteMany({ where: { personId: { in: personIds } } });

  await prisma.assetAssignment.deleteMany({ where: { personId: { in: personIds } } });
  await prisma.hardwareAsset.deleteMany({ where: { notes: "Demo asset" } });
  await prisma.documentRecord.deleteMany({ where: { personId: { in: personIds } } });

  await prisma.payrollLine.deleteMany({ where: { personId: { in: personIds } } });
  await prisma.compensationAgreement.deleteMany({ where: { personId: { in: personIds } } });
  await prisma.ventureMembership.deleteMany({ where: { personId: { in: personIds } } });

  await prisma.auditLog.deleteMany({
    where: { OR: [{ entityId: { in: [...personIds, ...taskIds] } }, { actorUserId: { in: users.map((u) => u.id) } }] },
  });

  await prisma.person.deleteMany({ where: { id: { in: personIds } } });
  await prisma.loginAttempt.deleteMany({ where: { email: { contains: DEMO_MARKER } } });
  await prisma.user.deleteMany({ where: { email: { endsWith: DEMO_MARKER } } });

  // Any payroll run left with no lines was demo-only.
  const emptyRuns = await prisma.payrollRun.findMany({
    where: { lines: { none: {} } },
    select: { id: true },
  });
  await prisma.payrollRun.deleteMany({ where: { id: { in: emptyRuns.map((r) => r.id) } } });

  console.log(`  People removed: ${users.length}`);
  console.log(`  Tasks removed: ${taskIds.length}`);
  console.log(`  Empty payroll runs removed: ${emptyRuns.length}`);
  console.log("\nDemo data cleared.\n");
}

main()
  .catch((e) => {
    console.error("Clear failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
