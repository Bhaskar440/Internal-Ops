/**
 * Efficiency calculation (spec §24, §25).
 *
 * Two rules this module exists to protect:
 *   1. Efficiency = estimated / actual * 100. Over-running lowers it
 *      (8h est / 10h actual = 80%); finishing early raises it above 100%.
 *   2. Aggregate efficiency is SUM(estimated) / SUM(actual) * 100 — NEVER the
 *      mean of individual percentages. Averaging percentages lets a trivial
 *      5-minute task weigh as heavily as a 40-hour one.
 *
 * `null` means "not calculable" (no actual time logged). The UI renders it as
 * "-", never Infinity, NaN or 0 (§24).
 */

/** Efficiency for a single task. Returns null when no actual time is recorded. */
export function calculateEfficiency(
  estimatedMinutes: number,
  actualMinutes: number,
): number | null {
  assertNonNegative(estimatedMinutes, "estimatedMinutes");
  assertNonNegative(actualMinutes, "actualMinutes");

  if (actualMinutes === 0) return null; // §24: display "-", never divide by zero
  return (estimatedMinutes / actualMinutes) * 100;
}

/**
 * Portfolio/venture/person efficiency across many tasks.
 *
 * Deliberately sums both sides before dividing (§25). Do not replace this with
 * an average of calculateEfficiency() results.
 */
export function aggregateEfficiency(
  rows: ReadonlyArray<{ estimatedMinutes: number; actualMinutes: number }>,
): number | null {
  let estimated = 0;
  let actual = 0;

  for (const row of rows) {
    assertNonNegative(row.estimatedMinutes, "estimatedMinutes");
    assertNonNegative(row.actualMinutes, "actualMinutes");
    estimated += row.estimatedMinutes;
    actual += row.actualMinutes;
  }

  if (actual === 0) return null;
  return (estimated / actual) * 100;
}

/** Signed variance in minutes. Positive = over estimate, negative = under. */
export function variance(estimatedMinutes: number, actualMinutes: number): number {
  assertNonNegative(estimatedMinutes, "estimatedMinutes");
  assertNonNegative(actualMinutes, "actualMinutes");
  return actualMinutes - estimatedMinutes;
}

/** Render efficiency for display: null becomes "-" (§24). */
export function formatEfficiency(value: number | null, fractionDigits = 0): string {
  if (value === null) return "-";
  return `${value.toFixed(fractionDigits)}%`;
}

function assertNonNegative(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${label} must be a finite, non-negative number, got ${value}`);
  }
}

// --- duration conversions ---------------------------------------------------
// §15: estimates are stored as INTEGER minutes. Hours only exist at the UI edge.

/** Convert a user-entered hours value to whole minutes for storage. */
export function hoursToMinutes(hours: number): number {
  if (!Number.isFinite(hours) || hours < 0) {
    throw new RangeError(`hours must be a finite, non-negative number, got ${hours}`);
  }
  return Math.round(hours * 60);
}

/** Convert stored minutes back to hours for display. */
export function minutesToHours(minutes: number): number {
  assertNonNegative(minutes, "minutes");
  return minutes / 60;
}

/** Whole minutes from a duration in seconds, rounding to nearest. */
export function secondsToMinutes(seconds: number): number {
  assertNonNegative(seconds, "seconds");
  return Math.round(seconds / 60);
}

/** Human-readable duration, e.g. 450 -> "7h 30m". */
export function formatMinutes(minutes: number): string {
  assertNonNegative(minutes, "minutes");
  const whole = Math.round(minutes);
  const h = Math.floor(whole / 60);
  const m = whole % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}
