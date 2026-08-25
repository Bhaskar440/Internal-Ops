import { DateTime } from "luxon";

/**
 * Business-date derivation (spec §22).
 *
 * Rules this module exists to enforce:
 *   - Timestamps are stored in UTC; business days are venture-local.
 *   - The server timezone is NEVER used. Every function takes an explicit
 *     IANA zone from the venture.
 *   - A business date is a LABEL ("2026-08-25"), not an instant. Keeping it a
 *     string in the domain layer avoids the classic off-by-one where Prisma
 *     hydrates a `@db.Date` to UTC midnight and a UTC+5:30 client renders the
 *     previous day.
 */

/** A calendar day label in `YYYY-MM-DD` form, always venture-local. */
export type BusinessDate = string;

const BUSINESS_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export class InvalidTimezoneError extends Error {
  constructor(tz: string) {
    super(`Invalid IANA timezone: "${tz}"`);
    this.name = "InvalidTimezoneError";
  }
}

export class InvalidBusinessDateError extends Error {
  constructor(value: string) {
    super(`Invalid business date: "${value}" (expected YYYY-MM-DD)`);
    this.name = "InvalidBusinessDateError";
  }
}

export function assertValidTimezone(tz: string): void {
  if (!DateTime.local().setZone(tz).isValid) throw new InvalidTimezoneError(tz);
}

export function isValidTimezone(tz: string): boolean {
  return DateTime.local().setZone(tz).isValid;
}

export function assertValidBusinessDate(value: string): asserts value is BusinessDate {
  if (!BUSINESS_DATE_RE.test(value)) throw new InvalidBusinessDateError(value);
  if (!DateTime.fromISO(value, { zone: "utc" }).isValid) {
    throw new InvalidBusinessDateError(value);
  }
}

/**
 * The business date an instant belongs to, in the venture's timezone.
 *
 * A timer that runs 23:00 -> 01:00 is attributed entirely to the date of its
 * START (see plan). We deliberately do not split entries across days: a split
 * would have to attach to a second DailyLog that may already be APPROVED or
 * LOCKED, which is unresolvable, and it would break "one source of truth for
 * time" (§2). Calendar-accurate allocation, if ever needed, belongs in the
 * reporting layer where it is reversible.
 */
export function toBusinessDate(instant: Date, ventureTimezone: string): BusinessDate {
  assertValidTimezone(ventureTimezone);
  const dt = DateTime.fromJSDate(instant, { zone: ventureTimezone });
  if (!dt.isValid) throw new Error(`Invalid instant passed to toBusinessDate: ${instant}`);
  return dt.toFormat("yyyy-MM-dd");
}

/**
 * The UTC half-open interval [startUtc, endUtc) covering one venture-local day.
 *
 * Uses startOf('day') + plus({ days: 1 }) rather than adding 86_400 seconds, so
 * DST transitions (23- or 25-hour days) stay correct. Asia/Kolkata has no DST,
 * but venture.timezone is configurable and this must not silently break when a
 * venture in a DST zone is added.
 */
export function businessDayBounds(
  businessDate: BusinessDate,
  ventureTimezone: string,
): { startUtc: Date; endUtc: Date } {
  assertValidBusinessDate(businessDate);
  assertValidTimezone(ventureTimezone);

  const start = DateTime.fromISO(businessDate, { zone: ventureTimezone }).startOf("day");
  const end = start.plus({ days: 1 });

  return { startUtc: start.toUTC().toJSDate(), endUtc: end.toUTC().toJSDate() };
}

/**
 * Instant at which a venture-local business day ends — i.e. the point after
 * which a missing daily log counts as genuinely missing (§32).
 */
export function businessDayEnd(businessDate: BusinessDate, ventureTimezone: string): Date {
  return businessDayBounds(businessDate, ventureTimezone).endUtc;
}

/**
 * Deadline for employee self-service edits (§29): the end of the business day
 * plus the venture's configured window.
 */
export function editWindowDeadline(
  businessDate: BusinessDate,
  ventureTimezone: string,
  editWindowHours: number,
): Date {
  if (!Number.isFinite(editWindowHours) || editWindowHours < 0) {
    throw new Error(`editWindowHours must be a non-negative number, got ${editWindowHours}`);
  }
  const { endUtc } = businessDayBounds(businessDate, ventureTimezone);
  return DateTime.fromJSDate(endUtc, { zone: "utc" })
    .plus({ hours: editWindowHours })
    .toJSDate();
}

export function isWithinEditWindow(
  businessDate: BusinessDate,
  ventureTimezone: string,
  editWindowHours: number,
  now: Date,
): boolean {
  return now.getTime() <= editWindowDeadline(businessDate, ventureTimezone, editWindowHours).getTime();
}

/** Today's business date for a venture. `now` is injectable so tests never depend on real time. */
export function currentBusinessDate(ventureTimezone: string, now: Date = new Date()): BusinessDate {
  return toBusinessDate(now, ventureTimezone);
}

/** ISO weekday, 1=Monday..7=Sunday, in venture-local terms. */
export function businessDateWeekday(businessDate: BusinessDate, ventureTimezone: string): number {
  assertValidBusinessDate(businessDate);
  assertValidTimezone(ventureTimezone);
  return DateTime.fromISO(businessDate, { zone: ventureTimezone }).weekday;
}

/** Whether a business date falls on one of the venture's configured working days. */
export function isWorkingDay(
  businessDate: BusinessDate,
  ventureTimezone: string,
  workingDays: readonly number[],
): boolean {
  return workingDays.includes(businessDateWeekday(businessDate, ventureTimezone));
}

/** Inclusive list of business dates between two labels. Used by reports and payroll periods. */
export function eachBusinessDate(from: BusinessDate, to: BusinessDate): BusinessDate[] {
  assertValidBusinessDate(from);
  assertValidBusinessDate(to);

  let cursor = DateTime.fromISO(from, { zone: "utc" });
  const end = DateTime.fromISO(to, { zone: "utc" });
  if (cursor > end) return [];

  const out: BusinessDate[] = [];
  while (cursor <= end) {
    out.push(cursor.toFormat("yyyy-MM-dd"));
    cursor = cursor.plus({ days: 1 });
  }
  return out;
}

/** Count working days in an inclusive range — the denominator for prorated monthly pay (§38 Option B). */
export function countWorkingDays(
  from: BusinessDate,
  to: BusinessDate,
  ventureTimezone: string,
  workingDays: readonly number[],
): number {
  return eachBusinessDate(from, to).filter((d) => isWorkingDay(d, ventureTimezone, workingDays)).length;
}

/**
 * Convert a `@db.Date` value coming out of Prisma into a business-date label.
 * Prisma returns DATE columns as a JS Date at UTC midnight, so it must be read
 * in UTC — reading it in local time is exactly the off-by-one this guards.
 */
export function fromPrismaDate(value: Date): BusinessDate {
  return DateTime.fromJSDate(value, { zone: "utc" }).toFormat("yyyy-MM-dd");
}

/** Convert a business-date label into the UTC-midnight Date that Prisma expects for `@db.Date`. */
export function toPrismaDate(businessDate: BusinessDate): Date {
  assertValidBusinessDate(businessDate);
  return DateTime.fromISO(businessDate, { zone: "utc" }).toJSDate();
}
