import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

/**
 * Prisma client for integration tests.
 *
 * Always bound to TEST_DATABASE_URL (port 5441) so a test run can never touch
 * development data (§66). tests/setup.ts also mirrors TEST_DATABASE_URL onto
 * DATABASE_URL, but this resolves it explicitly so the intent is local.
 */

const connectionString = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("TEST_DATABASE_URL is not set — cannot run integration tests.");
}

if (!/localhost|127\.0\.0\.1/.test(connectionString)) {
  throw new Error(
    "Refusing to run integration tests against a non-local database. " +
      "Integration tests destroy data; point TEST_DATABASE_URL at the local test container.",
  );
}

export const testPrisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
  log: ["error"],
});
