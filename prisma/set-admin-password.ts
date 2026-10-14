import "dotenv/config";
import fs from "node:fs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

const EMAIL = "admin@portfolioops.local";
const PASSWORD = "Password123";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

// Uses whichever hashing library your project already has, so login can verify it.
async function hashPassword(pw: string): Promise<string> {
  const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  if (deps["bcryptjs"]) {
    const m: any = await import("bcryptjs");
    return (m.default ?? m).hash(pw, 12);
  }
  if (deps["bcrypt"]) {
    const m: any = await import("bcrypt");
    return (m.default ?? m).hash(pw, 12);
  }
  if (deps["@node-rs/argon2"]) {
    const m: any = await import("@node-rs/argon2");
    return m.hash(pw);
  }
  if (deps["argon2"]) {
    const m: any = await import("argon2");
    return (m.default ?? m).hash(pw);
  }
  throw new Error("No known hashing library found in package.json");
}

async function main() {
  const passwordHash = await hashPassword(PASSWORD);

  const user = await prisma.user.update({
    where: { email: EMAIL },
    data: { passwordHash, accountStatus: "ACTIVE", emailVerified: new Date() },
  });

  // Clear failed-login records so the rate limiter doesn't lock you out.
  await prisma.loginAttempt.deleteMany({ where: { email: EMAIL } });
  await prisma.verificationToken.deleteMany({ where: { identifier: EMAIL } });

  console.log(`Done. ${user.email} is ACTIVE with the new password.`);
}

main()
  .catch((e) => {
    console.error("Failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());