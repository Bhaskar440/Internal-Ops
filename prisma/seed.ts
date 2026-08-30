import "dotenv/config";
import crypto from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

/**
 * Seeds the first Super Admin and the initial ventures (§83, §84).
 *
 * Idempotent: re-running updates rather than duplicating. Nothing here is
 * hardcoded application behaviour — ventures, people and rates are ordinary
 * rows the admin can change in the UI (§85).
 */

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is not set.");

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

const SUPER_ADMIN_EMAIL = process.env.SEED_SUPER_ADMIN_EMAIL ?? "admin@portfolioops.local";
const SUPER_ADMIN_NAME = process.env.SEED_SUPER_ADMIN_NAME ?? "Ops Admin";

/**
 * The seed never sets a password. It used to accept one, which meant whoever
 * ran the script had held the credential for the account that controls
 * payroll. The owner now sets their own through an invitation link.
 */
if (process.env.SEED_SUPER_ADMIN_PASSWORD) {
  throw new Error(
    [
      "SEED_SUPER_ADMIN_PASSWORD is no longer used and must not be set.",
      "The first Super Admin sets their own password from the invitation link",
      "this script prints. Unset the variable and run the seed again.",
    ].join("\n"),
  );
}

/** Initial ventures (§84). Editable in-app; these are just starting rows. */
const VENTURES = [
  { name: "Norvik Gold", slug: "norvik-gold", tagColor: "#b45309" },
  { name: "Thought Agile", slug: "thought-agile", tagColor: "#2563eb" },
  { name: "Falcon Brews", slug: "falcon-brews", tagColor: "#15803d" },
];

async function main() {
  console.log("Seeding Portfolio Ops...\n");

  // --- First Super Admin (§83) ---------------------------------------------
  //
  // Created WITHOUT a password. The account is PENDING and carries an
  // invitation token; the owner opens the link and chooses their own password,
  // exactly as every later invited person does. Nobody who runs this script
  // ever knows the credential, which is the point: seeding a password means
  // someone other than the account holder has held it.
  const admin = await prisma.user.upsert({
    where: { email: SUPER_ADMIN_EMAIL },
    update: { globalRole: "SUPER_ADMIN" },
    create: {
      name: SUPER_ADMIN_NAME,
      email: SUPER_ADMIN_EMAIL,
      globalRole: "SUPER_ADMIN",
      accountStatus: "PENDING",
      person: { create: { employmentType: "EMPLOYEE", startDate: new Date() } },
    },
    include: { person: true },
  });

  let inviteUrl: string | null = null;
  if (admin.passwordHash === null) {
    // Re-running before the invite is accepted issues a fresh link rather than
    // leaving the old one valid alongside it.
    await prisma.verificationToken.deleteMany({ where: { identifier: admin.email } });

    const token = crypto.randomBytes(32).toString("base64url");
    await prisma.verificationToken.create({
      data: {
        identifier: admin.email,
        token,
        expires: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });
    const base = process.env.AUTH_URL ?? "http://localhost:3000";
    inviteUrl = `${base}/invite/${token}`;
  }

  console.log(`  Super Admin: ${admin.email}`);

  // --- Ventures (§84) ------------------------------------------------------
  const ventures = [];
  for (const v of VENTURES) {
    const venture = await prisma.venture.upsert({
      where: { slug: v.slug },
      update: { name: v.name, tagColor: v.tagColor },
      create: {
        ...v,
        timezone: "Asia/Kolkata",
        workingDays: [1, 2, 3, 4, 5],
        dailyLogEditWindowHours: 48,
        defaultCurrency: "INR",
      },
    });
    ventures.push(venture);
    console.log(`  Venture: ${venture.name} (${venture.timezone}, ${venture.defaultCurrency})`);
  }

  // Super admin belongs to every venture as MANAGER so the dashboard is usable
  // immediately. Access still derives from globalRole = SUPER_ADMIN.
  if (admin.person) {
    for (const venture of ventures) {
      await prisma.ventureMembership.upsert({
        where: { ventureId_personId: { ventureId: venture.id, personId: admin.person.id } },
        update: { accessRole: "MANAGER" },
        create: { ventureId: venture.id, personId: admin.person.id, accessRole: "MANAGER" },
      });
    }
  }

  console.log("\nSeed complete.");

  if (inviteUrl) {
    console.log("\n  The first Super Admin has NO password yet.");
    console.log(`  Send ${SUPER_ADMIN_EMAIL} this link so they can set their own:\n`);
    console.log(`    ${inviteUrl}\n`);
    console.log("  It expires in 7 days. Re-run this seed to issue a new one.\n");
  } else {
    console.log(`  ${SUPER_ADMIN_EMAIL} has already set a password; sign in as usual.\n`);
  }
}

main()
  .catch((e) => {
    console.error("Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
