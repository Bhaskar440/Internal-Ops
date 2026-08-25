import "dotenv/config";
import bcrypt from "bcryptjs";
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
const SUPER_ADMIN_PASSWORD = process.env.SEED_SUPER_ADMIN_PASSWORD ?? "ChangeMe!2026";
const SUPER_ADMIN_NAME = process.env.SEED_SUPER_ADMIN_NAME ?? "Ops Admin";

/** Initial ventures (§84). Editable in-app; these are just starting rows. */
const VENTURES = [
  { name: "Norvik Gold", slug: "norvik-gold", tagColor: "#b45309" },
  { name: "Thought Agile", slug: "thought-agile", tagColor: "#2563eb" },
  { name: "Falcon Brews", slug: "falcon-brews", tagColor: "#15803d" },
];

async function main() {
  console.log("Seeding Portfolio Ops...\n");

  // --- First Super Admin (§83) ---------------------------------------------
  const passwordHash = await bcrypt.hash(SUPER_ADMIN_PASSWORD, 12);
  const admin = await prisma.user.upsert({
    where: { email: SUPER_ADMIN_EMAIL },
    update: { globalRole: "SUPER_ADMIN", accountStatus: "ACTIVE" },
    create: {
      name: SUPER_ADMIN_NAME,
      email: SUPER_ADMIN_EMAIL,
      passwordHash,
      globalRole: "SUPER_ADMIN",
      accountStatus: "ACTIVE",
      emailVerified: new Date(),
      person: { create: { employmentType: "EMPLOYEE", startDate: new Date() } },
    },
    include: { person: true },
  });
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
  console.log(`  Login: ${SUPER_ADMIN_EMAIL} / ${SUPER_ADMIN_PASSWORD}`);
  console.log("  Change this password before any real use.\n");
}

main()
  .catch((e) => {
    console.error("Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
