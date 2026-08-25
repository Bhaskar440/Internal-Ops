import { describe, it, expect } from "vitest";
import {
  toBusinessDate,
  businessDayBounds,
  editWindowDeadline,
  isWithinEditWindow,
  isWorkingDay,
  eachBusinessDate,
  countWorkingDays,
  fromPrismaDate,
  toPrismaDate,
  businessDateWeekday,
  InvalidTimezoneError,
  InvalidBusinessDateError,
} from "@/lib/timezone/businessDate";

const KOLKATA = "Asia/Kolkata"; // UTC+5:30, no DST
const NEW_YORK = "America/New_York"; // DST — used to keep the helpers honest

describe("toBusinessDate", () => {
  it("uses venture-local time, not UTC", () => {
    // 2026-08-25T20:00Z is 2026-08-26 01:30 in Kolkata -> next business day.
    const instant = new Date("2026-08-25T20:00:00Z");
    expect(toBusinessDate(instant, KOLKATA)).toBe("2026-08-26");
    expect(toBusinessDate(instant, "UTC")).toBe("2026-08-25");
  });

  it("handles the moment just before venture-local midnight", () => {
    // 18:29Z == 23:59 Kolkata, still the 25th.
    expect(toBusinessDate(new Date("2026-08-25T18:29:00Z"), KOLKATA)).toBe("2026-08-25");
    // 18:30Z == 00:00 Kolkata on the 26th.
    expect(toBusinessDate(new Date("2026-08-25T18:30:00Z"), KOLKATA)).toBe("2026-08-26");
  });

  it("rejects an invalid timezone rather than silently using the server zone", () => {
    expect(() => toBusinessDate(new Date(), "Not/AZone")).toThrow(InvalidTimezoneError);
  });
});

describe("midnight-spanning timer (§22)", () => {
  it("attributes a 23:00->01:00 session entirely to the START date", () => {
    // 23:00 Kolkata on the 25th == 17:30Z; 01:00 on the 26th == 19:30Z.
    const started = new Date("2026-08-25T17:30:00Z");
    const ended = new Date("2026-08-25T19:30:00Z");

    // The rule under test: business date comes from startedAt only.
    expect(toBusinessDate(started, KOLKATA)).toBe("2026-08-25");
    expect(toBusinessDate(ended, KOLKATA)).toBe("2026-08-26");

    const durationHours = (ended.getTime() - started.getTime()) / 3_600_000;
    expect(durationHours).toBe(2);
  });
});

describe("businessDayBounds", () => {
  it("spans exactly 24h in a non-DST zone", () => {
    const { startUtc, endUtc } = businessDayBounds("2026-08-25", KOLKATA);
    // Kolkata midnight is 18:30Z the previous day.
    expect(startUtc.toISOString()).toBe("2026-08-24T18:30:00.000Z");
    expect(endUtc.toISOString()).toBe("2026-08-25T18:30:00.000Z");
    expect((endUtc.getTime() - startUtc.getTime()) / 3_600_000).toBe(24);
  });

  it("produces a 23-hour day when DST springs forward", () => {
    // 2026-03-08 is the US spring-forward date.
    const { startUtc, endUtc } = businessDayBounds("2026-03-08", NEW_YORK);
    expect((endUtc.getTime() - startUtc.getTime()) / 3_600_000).toBe(23);
  });

  it("produces a 25-hour day when DST falls back", () => {
    // 2026-11-01 is the US fall-back date.
    const { startUtc, endUtc } = businessDayBounds("2026-11-01", NEW_YORK);
    expect((endUtc.getTime() - startUtc.getTime()) / 3_600_000).toBe(25);
  });

  it("rejects a malformed business date", () => {
    expect(() => businessDayBounds("25-08-2026", KOLKATA)).toThrow(InvalidBusinessDateError);
  });
});

describe("edit window (§29)", () => {
  it("closes 48h after the end of the venture-local business day", () => {
    // Business day 2026-08-25 in Kolkata ends 2026-08-25T18:30Z; +48h.
    const deadline = editWindowDeadline("2026-08-25", KOLKATA, 48);
    expect(deadline.toISOString()).toBe("2026-08-27T18:30:00.000Z");
  });

  it("allows edits before the deadline and blocks them after", () => {
    const before = new Date("2026-08-27T18:29:00Z");
    const after = new Date("2026-08-27T18:31:00Z");
    expect(isWithinEditWindow("2026-08-25", KOLKATA, 48, before)).toBe(true);
    expect(isWithinEditWindow("2026-08-25", KOLKATA, 48, after)).toBe(false);
  });

  it("treats a zero-hour window as closing at end of business day", () => {
    expect(isWithinEditWindow("2026-08-25", KOLKATA, 0, new Date("2026-08-25T18:29:00Z"))).toBe(true);
    expect(isWithinEditWindow("2026-08-25", KOLKATA, 0, new Date("2026-08-25T18:31:00Z"))).toBe(false);
  });
});

describe("working days", () => {
  it("identifies weekends against a Mon-Fri venture", () => {
    const monFri = [1, 2, 3, 4, 5];
    // 2026-08-25 is a Tuesday; 2026-08-29 a Saturday; 2026-08-30 a Sunday.
    expect(businessDateWeekday("2026-08-25", KOLKATA)).toBe(2);
    expect(isWorkingDay("2026-08-25", KOLKATA, monFri)).toBe(true);
    expect(isWorkingDay("2026-08-29", KOLKATA, monFri)).toBe(false);
    expect(isWorkingDay("2026-08-30", KOLKATA, monFri)).toBe(false);
  });

  it("counts working days across a full week", () => {
    expect(countWorkingDays("2026-08-24", "2026-08-30", KOLKATA, [1, 2, 3, 4, 5])).toBe(5);
  });
});

describe("eachBusinessDate", () => {
  it("is inclusive of both ends", () => {
    expect(eachBusinessDate("2026-08-25", "2026-08-27")).toEqual([
      "2026-08-25",
      "2026-08-26",
      "2026-08-27",
    ]);
  });

  it("returns a single day when from == to", () => {
    expect(eachBusinessDate("2026-08-25", "2026-08-25")).toEqual(["2026-08-25"]);
  });

  it("returns empty when the range is inverted", () => {
    expect(eachBusinessDate("2026-08-27", "2026-08-25")).toEqual([]);
  });

  it("crosses a month boundary", () => {
    expect(eachBusinessDate("2026-08-30", "2026-09-01")).toEqual([
      "2026-08-30",
      "2026-08-31",
      "2026-09-01",
    ]);
  });
});

describe("Prisma @db.Date round-trip", () => {
  it("survives a round trip without an off-by-one", () => {
    const label = "2026-08-25";
    expect(fromPrismaDate(toPrismaDate(label))).toBe(label);
  });

  it("reads a UTC-midnight DATE as the same calendar day", () => {
    // This is the trap: read in local time, a UTC+5:30 client would see the 24th.
    expect(fromPrismaDate(new Date("2026-08-25T00:00:00Z"))).toBe("2026-08-25");
  });
});
