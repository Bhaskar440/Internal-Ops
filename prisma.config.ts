import "dotenv/config";
import { defineConfig } from "prisma/config";

/**
 * Prisma 7 moved the connection URL out of the `datasource` block in
 * schema.prisma — a schema containing `url = ...` now fails validation.
 * Migrate/Studio read the connection from here instead.
 *
 * Set PRISMA_TARGET_TEST=1 to point the CLI at the integration-test database
 * (used by the test setup script) so tests never touch dev data (§66).
 */
const url =
  process.env.PRISMA_TARGET_TEST === "1"
    ? process.env.TEST_DATABASE_URL
    : (process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL);

if (!url) {
  throw new Error(
    "DATABASE_URL is not set. Copy .env.example to .env and start the database with `npm run db:up`.",
  );
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url,
  },
});
