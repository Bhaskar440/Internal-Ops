import { z } from "zod";

/**
 * Shared calendar-date validation.
 *
 * A native date input has no upper bound on the year segment: typing into it
 * keeps accepting digits, so "202600-01-01" can be submitted. The regex alone
 * rejects that (it anchors to four digits), but still admits year 0001 and
 * 9999, which are always a typo rather than an intention.
 *
 * The UI sets matching min/max on the control so the picker refuses out-of-range
 * values first; this is the server-side backstop, which is the one that counts.
 */

export const DATE_MIN = "2000-01-01";
export const DATE_MAX = "2100-12-31";

const SHAPE = /^\d{4}-\d{2}-\d{2}$/;

/** `YYYY-MM-DD` within the supported range, and a real calendar date. */
export const dateString = z
  .string()
  .trim()
  .regex(SHAPE, "Use the date picker.")
  .refine((v) => v >= DATE_MIN && v <= DATE_MAX, {
    message: `Enter a date between ${DATE_MIN.slice(0, 4)} and ${DATE_MAX.slice(0, 4)}.`,
  })
  .refine(isRealDate, { message: "That date does not exist." });

/**
 * Rejects 2026-02-30 and similar. Date.UTC rolls overflow forward silently, so
 * compare the parts back against what was asked for.
 */
function isRealDate(v: string): boolean {
  const [y, m, d] = v.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
  );
}

/**
 * Optional date field. An untouched date input submits "", which must mean
 * "not provided" rather than failing validation.
 */
export const optionalDateString = z.preprocess(
  (v) => (v === "" || v === null ? undefined : v),
  dateString.optional(),
);
