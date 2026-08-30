import { describe, it, expect } from "vitest";
import { dateString, optionalDateString } from "@/lib/validation/dateString";

/**
 * A native date input accepts unlimited digits in its year segment, so
 * "202600-01-01" can reach the server. These cover the shape, the range and
 * the calendar itself.
 */

describe("dateString", () => {
  it("accepts an ordinary date", () => {
    expect(dateString.parse("2026-08-31")).toBe("2026-08-31");
  });

  it("rejects a year longer than four digits", () => {
    expect(dateString.safeParse("202600-01-01").success).toBe(false);
  });

  it("rejects years outside the supported range", () => {
    expect(dateString.safeParse("0001-01-01").success).toBe(false);
    expect(dateString.safeParse("9999-12-31").success).toBe(false);
  });

  it("accepts the range boundaries", () => {
    expect(dateString.safeParse("2000-01-01").success).toBe(true);
    expect(dateString.safeParse("2100-12-31").success).toBe(true);
  });

  it("rejects a date that does not exist", () => {
    expect(dateString.safeParse("2026-02-30").success).toBe(false);
    expect(dateString.safeParse("2026-13-01").success).toBe(false);
  });

  it("keeps 29 February in a leap year", () => {
    expect(dateString.safeParse("2028-02-29").success).toBe(true);
    expect(dateString.safeParse("2027-02-29").success).toBe(false);
  });

  it("rejects malformed input", () => {
    expect(dateString.safeParse("31-08-2026").success).toBe(false);
    expect(dateString.safeParse("2026-8-31").success).toBe(false);
    expect(dateString.safeParse("").success).toBe(false);
  });
});

describe("optionalDateString", () => {
  it("treats an untouched field as absent", () => {
    // An empty date input submits "" — that means "not provided", not invalid.
    expect(optionalDateString.parse("")).toBeUndefined();
    expect(optionalDateString.parse(undefined)).toBeUndefined();
  });

  it("still validates a value that was provided", () => {
    expect(optionalDateString.safeParse("202600-01-01").success).toBe(false);
    expect(optionalDateString.parse("2026-08-31")).toBe("2026-08-31");
  });
});
