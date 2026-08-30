import "dotenv/config";

/**
 * Integration tests always talk to TEST_DATABASE_URL (a separate database), never the dev
 * database. Spec §66: never test payroll workflows against live data.
 */
const testUrl = process.env.TEST_DATABASE_URL;
const devUrl = process.env.DATABASE_URL;

if (testUrl) {
  /**
   * Refuse to run if the two point at the same place.
   *
   * The tests delete rows as they go. With a local setup the URLs differed by
   * port and confusing them was hard; with hosted branches they differ by a few
   * characters in the hostname, so one bad paste would quietly wipe the
   * development data instead of failing.
   */
  if (devUrl && sameDatabase(devUrl, testUrl)) {
    throw new Error(
      [
        "TEST_DATABASE_URL and DATABASE_URL point at the same database.",
        "Integration tests delete data, so this would destroy your development records.",
        "Point TEST_DATABASE_URL at a separate database or branch.",
      ].join("\n"),
    );
  }

  process.env.DATABASE_URL = testUrl;
}

/** Compare host, port and database name; credentials and query params differ harmlessly. */
function sameDatabase(a: string, b: string): boolean {
  try {
    const ua = new URL(a);
    const ub = new URL(b);
    return (
      ua.host === ub.host && ua.pathname === ub.pathname
    );
  } catch {
    // An unparseable URL is not something to guess about; let the driver report it.
    return false;
  }
}
