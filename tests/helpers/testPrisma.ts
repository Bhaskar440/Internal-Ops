import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

/**
 * Prisma client for integration tests.
 *
 * Always bound to TEST_DATABASE_URL (a separate database) so a test run can never touch
 * development data (§66). tests/setup.ts also mirrors TEST_DATABASE_URL onto
 * DATABASE_URL, but this resolves it explicitly so the intent is local.
 */

const connectionString = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("TEST_DATABASE_URL is not set — cannot run integration tests.");
}

/**
 * Integration tests delete rows as they run, so a hosted database has to be
 * opted into deliberately. ALLOW_REMOTE_TESTS=1 is for a dedicated test branch;
 * without it only a local database is accepted, which keeps a stray
 * TEST_DATABASE_URL from destroying a real deployment.
 *
 * tests/setup.ts separately refuses to run when this URL matches DATABASE_URL,
 * so opting in still cannot point the tests at development data.
 */
if (!/localhost|127\.0\.0\.1/.test(connectionString) && process.env.ALLOW_REMOTE_TESTS !== "1") {
  throw new Error(
    [
      "Refusing to run integration tests against a database that is not on this machine.",
      "",
      "These tests DELETE data. Point TEST_DATABASE_URL at a database whose",
      "contents you are willing to lose - a dedicated branch, never the one the",
      "application uses.",
      "",
      "For a hosted test branch, say so explicitly:",
      "  PowerShell:  $env:ALLOW_REMOTE_TESTS = '1'; npm test",
      "  Bash:        ALLOW_REMOTE_TESTS=1 npm test",
    ].join("\n"),
  );
}

export const testPrisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
  log: ["error"],
});
