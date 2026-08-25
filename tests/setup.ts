import "dotenv/config";

/**
 * Integration tests always talk to TEST_DATABASE_URL (port 5441), never the dev
 * database. Spec §66: never test payroll workflows against live data.
 */
if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}
