import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

/**
 * Demo data for evaluating the product.
 *
 * DELIBERATELY SEPARATE from prisma/seed.ts. The real seed creates only the
 * first Super Admin and the ventures; this adds fictional people, tasks, hours
 * and a payroll run so the screens can be judged with something in them.
 *
 *   npm run db:demo         populate
 *   npm run db:demo:clear   remove everything it created
 *
 * Everything it creates is tagged with DEMO_MARKER so removal is exact and
 * cannot touch real records. It refuses to run against a non-local database.
 */

const DEMO_MARKER = "demo.portfolioops.local";
const DEMO_PASSWORD = "DemoPassword123";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is not set.");

/**
 * Demo data must never touch a real deployment: it invents people and a payroll
 * run with fabricated amounts, which is the last thing that should appear
 * alongside real records.
 *
 * A local database is allowed outright. Anything hosted requires
 * ALLOW_REMOTE_DEMO=1, which nobody types by accident — the point is that a
 * copied command cannot quietly populate a live system.
 */
const isLocal = /localhost|127\.0\.0\.1/.test(connectionString);
if (!isLocal && process.env.ALLOW_REMOTE_DEMO !== "1") {
  throw new Error(
    [
      "Refusing to seed demo data into a database that is not on this machine.",
      "",
      "This script creates fictional people and a payroll run with invented",
      "amounts. On a live system that would sit alongside real records.",
      "",
      "If this is your own test database, say so explicitly:",
      "  PowerShell:  $env:ALLOW_REMOTE_DEMO = '1'; npm run db:demo",
      "  Bash:        ALLOW_REMOTE_DEMO=1 npm run db:demo",
    ].join("\n"),
  );
}
if (!isLocal) {
  console.log("  ALLOW_REMOTE_DEMO is set - writing demo data to a hosted database.\n");
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

type PersonSpec = {
  name: string;
  role: "MANAGER" | "MEMBER";
  employment: "EMPLOYEE" | "FREELANCER" | "CONTRACTOR";
  venture: string;
  payType: "HOURLY" | "MONTHLY_FIXED";
  rate: number;
};

const PEOPLE: PersonSpec[] = [
  { name: "Aarav Sharma", role: "MANAGER", employment: "EMPLOYEE", venture: "norvik-gold", payType: "MONTHLY_FIXED", rate: 120000 },
  { name: "Neha Iyer", role: "MEMBER", employment: "EMPLOYEE", venture: "norvik-gold", payType: "MONTHLY_FIXED", rate: 85000 },
  { name: "Rohan Desai", role: "MEMBER", employment: "FREELANCER", venture: "norvik-gold", payType: "HOURLY", rate: 1200 },
  { name: "Priya Menon", role: "MANAGER", employment: "EMPLOYEE", venture: "thought-agile", payType: "MONTHLY_FIXED", rate: 115000 },
  { name: "Kabir Nair", role: "MEMBER", employment: "EMPLOYEE", venture: "thought-agile", payType: "MONTHLY_FIXED", rate: 78000 },
  { name: "Ananya Rao", role: "MEMBER", employment: "CONTRACTOR", venture: "thought-agile", payType: "HOURLY", rate: 950 },
  { name: "Vikram Singh", role: "MANAGER", employment: "EMPLOYEE", venture: "falcon-brews", payType: "MONTHLY_FIXED", rate: 110000 },
  { name: "Meera Joshi", role: "MEMBER", employment: "EMPLOYEE", venture: "falcon-brews", payType: "MONTHLY_FIXED", rate: 72000 },
];

/** Tasks per venture: title, estimated hours, status, and hours actually worked. */
const TASKS: Record<string, [string, number, string, number][]> = {
  "norvik-gold": [
    ["Q3 vendor contract review", 6, "DONE", 7],
    ["Refit assay lab reporting", 16, "DONE", 14],
    ["Supplier audit — Rajasthan site", 12, "IN_PROGRESS", 5],
    ["Update export documentation", 4, "REVIEW", 4],
    ["Annual insurance renewal", 3, "BACKLOG", 0],
  ],
  "thought-agile": [
    ["Client onboarding automation", 20, "DONE", 26],
    ["Rewrite pricing page", 8, "DONE", 6],
    ["Migrate CI to new runners", 10, "IN_PROGRESS", 6],
    ["Q4 roadmap workshop", 5, "REVIEW", 5],
    ["Accessibility audit", 12, "BACKLOG", 0],
  ],
  "falcon-brews": [
    ["Seasonal label design", 10, "DONE", 9],
    ["Distributor pricing model", 6, "DONE", 8],
    ["Tasting room booking flow", 14, "IN_PROGRESS", 4],
    ["Supplier switch — glass", 4, "BACKLOG", 0],
  ],
};

function isoDate(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** The last N weekdays, most recent first. Weekends are skipped. */
function recentWorkingDays(count: number): Date[] {
  const out: Date[] = [];
  const cursor = new Date();
  cursor.setUTCDate(cursor.getUTCDate() - 1); // start yesterday, so today stays open
  while (out.length < count) {
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) out.push(isoDate(new Date(cursor)));
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return out;
}

async function main() {
  console.log("Seeding demo data...\n");

  const admin = await prisma.user.findFirst({
    where: { globalRole: "SUPER_ADMIN" },
    select: { id: true, email: true, passwordHash: true, accountStatus: true },
  });
  if (!admin) {
    throw new Error("No Super Admin found. Run `npm run db:seed` first.");
  }

  // The real seed leaves this account PENDING with no password so its owner can
  // set their own from an invitation link. That is right for a handover and
  // useless for evaluation, where there has to be an admin to log in as. Give
  // it the demo password — safe here because this script already refuses to run
  // against anything but a local database.
  if (admin.passwordHash === null) {
    await prisma.user.update({
      where: { id: admin.id },
      data: {
        passwordHash: await bcrypt.hash(DEMO_PASSWORD, 12),
        accountStatus: "ACTIVE",
        emailVerified: new Date(),
      },
    });
    // Any outstanding invitation is void now that a password exists.
    await prisma.verificationToken.deleteMany({ where: { identifier: admin.email } });
    console.log(`  Super Admin activated for demo: ${admin.email} / ${DEMO_PASSWORD}`);
  }

  const ventures = await prisma.venture.findMany({
    where: { archivedAt: null },
    select: { id: true, slug: true, name: true, timezone: true, defaultCurrency: true },
  });
  const bySlug = new Map(ventures.map((v) => [v.slug, v]));

  if (bySlug.size === 0) {
    throw new Error("No ventures found. Run `npm run db:seed` first.");
  }

  // --- people ---------------------------------------------------------------
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);
  const personIdByName = new Map<string, string>();

  for (const spec of PEOPLE) {
    const venture = bySlug.get(spec.venture);
    if (!venture) continue;

    const email = `${spec.name.split(" ")[0].toLowerCase()}@${DEMO_MARKER}`;
    const existing = await prisma.user.findUnique({
      where: { email },
      select: { person: { select: { id: true } } },
    });

    if (existing?.person) {
      personIdByName.set(spec.name, existing.person.id);
      continue;
    }

    const user = await prisma.user.create({
      data: {
        name: spec.name,
        email,
        accountStatus: "ACTIVE",
        passwordHash,
        emailVerified: new Date(),
        person: {
          create: {
            employmentType: spec.employment,
            startDate: new Date(Date.UTC(2026, 0, 15)),
          },
        },
      },
      include: { person: true },
    });

    const personId = user.person!.id;
    personIdByName.set(spec.name, personId);

    await prisma.ventureMembership.create({
      data: { ventureId: venture.id, personId, accessRole: spec.role },
    });

    // Pay agreement, so payroll has something to calculate from.
    await prisma.compensationAgreement.create({
      data: {
        personId,
        payType: spec.payType,
        currency: venture.defaultCurrency,
        rate: spec.rate,
        effectiveFrom: new Date(Date.UTC(2026, 0, 1)),
        prorationPolicy: "FIXED_FULL",
        createdBy: admin.id,
      },
    });
  }
  console.log(`  People: ${personIdByName.size}`);

  // --- one pending registration, so the dashboard has something to action ----
  const pendingEmail = `pending@${DEMO_MARKER}`;
  if (!(await prisma.user.findUnique({ where: { email: pendingEmail } }))) {
    await prisma.user.create({
      data: {
        name: "Sana Kapoor",
        email: pendingEmail,
        accountStatus: "PENDING",
        person: { create: { employmentType: "FREELANCER" } },
      },
    });
    console.log("  Pending registration: Sana Kapoor");
  }

  // --- tasks ----------------------------------------------------------------
  const workingDays = recentWorkingDays(10);
  let taskCount = 0;
  let entryCount = 0;

  for (const [slug, specs] of Object.entries(TASKS)) {
    const venture = bySlug.get(slug);
    if (!venture) continue;

    const members = await prisma.ventureMembership.findMany({
      where: { ventureId: venture.id, leftAt: null },
      select: { personId: true },
    });
    const memberIds = members.map((m) => m.personId);
    if (memberIds.length === 0) continue;

    for (const [title, estHours, status, actualHours] of specs) {
      const existing = await prisma.task.findFirst({
        where: { ventureId: venture.id, title },
        select: { id: true },
      });
      if (existing) continue;

      const assignee = memberIds[taskCount % memberIds.length];
      const dueOffset = (taskCount % 5) - 2; // some past due, some upcoming
      const due = new Date();
      due.setUTCDate(due.getUTCDate() + dueOffset * 3);

      const task = await prisma.task.create({
        data: {
          ventureId: venture.id,
          title,
          description: `Demo task in ${venture.name}.`,
          estimatedMinutes: estHours * 60,
          status: status as never,
          priority: (["LOW", "MEDIUM", "HIGH", "URGENT"] as const)[taskCount % 4],
          dueDate: isoDate(due),
          createdBy: admin.id,
          startedAt: status === "BACKLOG" ? null : new Date(),
          completedAt: status === "DONE" ? new Date() : null,
          assignees: { create: { personId: assignee, assignedBy: admin.id } },
        },
        select: { id: true },
      });

      await prisma.taskStatusHistory.create({
        data: { taskId: task.id, fromStatus: null, toStatus: "BACKLOG", changedBy: admin.id },
      });
      if (status !== "BACKLOG") {
        await prisma.taskStatusHistory.create({
          data: {
            taskId: task.id,
            fromStatus: "BACKLOG",
            toStatus: status as never,
            changedBy: admin.id,
          },
        });
      }
      taskCount++;

      // Spread the worked hours across recent days, as approved time.
      let remaining = actualHours * 60;
      let dayIndex = 0;
      while (remaining > 0 && dayIndex < workingDays.length) {
        const chunk = Math.min(remaining, 240); // at most 4h a day per task
        const businessDate = workingDays[dayIndex];

        const log = await prisma.dailyLog.upsert({
          where: {
            personId_ventureId_businessDate: {
              personId: assignee,
              ventureId: venture.id,
              businessDate,
            },
          },
          update: { status: "APPROVED", approvedAt: new Date(), approvedBy: admin.id },
          create: {
            personId: assignee,
            ventureId: venture.id,
            businessDate,
            attendanceStatus: "PRESENT",
            status: "APPROVED",
            submittedAt: new Date(),
            approvedAt: new Date(),
            approvedBy: admin.id,
          },
          select: { id: true },
        });

        await prisma.timeEntry.create({
          data: {
            taskId: task.id,
            personId: assignee,
            ventureId: venture.id,
            dailyLogId: log.id,
            source: "MANUAL",
            startedAt: new Date(businessDate.getTime() + 9 * 3600 * 1000),
            endedAt: new Date(businessDate.getTime() + 9 * 3600 * 1000 + chunk * 60 * 1000),
            durationSeconds: chunk * 60,
            businessDate,
            approvalStatus: "APPROVED",
            note: "Demo time entry",
          },
        });

        entryCount++;
        remaining -= chunk;
        dayIndex++;
      }
    }
  }
  console.log(`  Tasks: ${taskCount}`);
  console.log(`  Time entries: ${entryCount} (approved)`);

  // --- one submitted day awaiting approval, so Approvals is not empty -------
  const firstPerson = [...personIdByName.values()][1];
  const firstVenture = bySlug.get("norvik-gold");
  if (firstPerson && firstVenture) {
    const yesterday = workingDays[0];
    const log = await prisma.dailyLog.upsert({
      where: {
        personId_ventureId_businessDate: {
          personId: firstPerson,
          ventureId: firstVenture.id,
          businessDate: yesterday,
        },
      },
      update: { status: "SUBMITTED", submittedAt: new Date(), approvedAt: null, approvedBy: null },
      create: {
        personId: firstPerson,
        ventureId: firstVenture.id,
        businessDate: yesterday,
        attendanceStatus: "REMOTE",
        status: "SUBMITTED",
        submittedAt: new Date(),
        generalNote: "Worked from home; supplier calls all afternoon.",
      },
      select: { id: true },
    });
    console.log(`  Awaiting approval: 1 day (log ${log.id.slice(0, 8)}…)`);
  }

  // --- a hardware asset and an expiring document ----------------------------
  const laptopTag = `DEMO-LT-001`;
  if (!(await prisma.hardwareAsset.findUnique({ where: { assetTag: laptopTag } }))) {
    const asset = await prisma.hardwareAsset.create({
      data: {
        itemName: "MacBook Pro 14",
        assetTag: laptopTag,
        serialNumber: "C02DEMO1234",
        status: "ISSUED",
        notes: "Demo asset",
      },
      select: { id: true },
    });
    const holder = [...personIdByName.values()][0];
    if (holder) {
      await prisma.assetAssignment.create({
        data: {
          assetId: asset.id,
          personId: holder,
          issuedAt: new Date(Date.UTC(2026, 1, 1)),
          issuedBy: admin.id,
          issueCondition: "New",
        },
      });
    }
    console.log("  Hardware: 1 laptop issued");
  }

  const docPerson = [...personIdByName.values()][2];
  if (docPerson) {
    const existingDoc = await prisma.documentRecord.findFirst({
      where: { personId: docPerson, docType: "Contractor agreement" },
    });
    if (!existingDoc) {
      const soon = new Date();
      soon.setUTCDate(soon.getUTCDate() + 21); // inside the 30-day warning window
      await prisma.documentRecord.create({
        data: {
          personId: docPerson,
          docType: "Contractor agreement",
          status: "VERIFIED",
          expiryDate: isoDate(soon),
          externalReferenceLink: "https://drive.example.com/demo-doc",
          notes: "Demo document",
          verifiedBy: admin.id,
          verifiedAt: new Date(),
        },
      });
      console.log("  Documents: 1 expiring soon");
    }
  }

  console.log("\nDemo data ready.");
  console.log(`  Demo accounts sign in with: ${DEMO_PASSWORD}`);
  console.log(`  e.g. aarav@${DEMO_MARKER} (manager), neha@${DEMO_MARKER} (member)`);
  console.log("  Remove it all with: npm run db:demo:clear\n");
}

main()
  .catch((e) => {
    console.error("Demo seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
