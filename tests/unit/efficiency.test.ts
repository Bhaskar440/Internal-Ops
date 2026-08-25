import { describe, it, expect } from "vitest";
import {
  calculateEfficiency,
  aggregateEfficiency,
  variance,
  formatEfficiency,
  hoursToMinutes,
  minutesToHours,
  secondsToMinutes,
  formatMinutes,
} from "@/lib/money/efficiency";

describe("calculateEfficiency (§24)", () => {
  it("matches the spec's worked examples", () => {
    // Estimated 8h, actual 10h -> 80%
    expect(calculateEfficiency(480, 600)).toBe(80);
    // Estimated 10h, actual 8h -> 125%
    expect(calculateEfficiency(600, 480)).toBe(125);
  });

  it("is exactly 100% when actual equals estimate", () => {
    expect(calculateEfficiency(480, 480)).toBe(100);
  });

  it("returns null (not Infinity) when no actual time is logged", () => {
    expect(calculateEfficiency(480, 0)).toBeNull();
  });

  it("returns 0 for a zero estimate with logged time — distinct from null", () => {
    expect(calculateEfficiency(0, 600)).toBe(0);
  });

  it("rejects negative input", () => {
    expect(() => calculateEfficiency(-1, 600)).toThrow(RangeError);
    expect(() => calculateEfficiency(480, -1)).toThrow(RangeError);
  });
});

describe("aggregateEfficiency (§25)", () => {
  it("sums both sides rather than averaging percentages", () => {
    const rows = [
      { estimatedMinutes: 480, actualMinutes: 600 }, // 80%
      { estimatedMinutes: 600, actualMinutes: 480 }, // 125%
    ];
    // Correct: 1080/1080 = 100%. Averaging the percentages would give 102.5%.
    expect(aggregateEfficiency(rows)).toBe(100);
  });

  it("does not let a tiny task outweigh a large one", () => {
    const rows = [
      { estimatedMinutes: 5, actualMinutes: 1 },     // 500% on a 5-minute task
      { estimatedMinutes: 2400, actualMinutes: 4800 }, // 50% on a 40-hour task
    ];
    const agg = aggregateEfficiency(rows)!;
    // Sum-based: 2405/4801 ~= 50.1%. Mean-of-percentages would be a wild 275%.
    expect(agg).toBeCloseTo(50.09, 1);
    expect(agg).toBeLessThan(60);
  });

  it("returns null when nothing has been logged", () => {
    expect(aggregateEfficiency([{ estimatedMinutes: 480, actualMinutes: 0 }])).toBeNull();
    expect(aggregateEfficiency([])).toBeNull();
  });

  it("ignores tasks with no actual time in the numerator sum only by summing raw totals", () => {
    const rows = [
      { estimatedMinutes: 480, actualMinutes: 480 },
      { estimatedMinutes: 120, actualMinutes: 0 },
    ];
    // 600 estimated / 480 actual = 125%
    expect(aggregateEfficiency(rows)).toBe(125);
  });
});

describe("variance", () => {
  it("is positive when over estimate and negative when under", () => {
    expect(variance(480, 600)).toBe(120);
    expect(variance(600, 480)).toBe(-120);
    expect(variance(480, 480)).toBe(0);
  });
});

describe("formatEfficiency", () => {
  it('renders null as "-" rather than Infinity or NaN', () => {
    expect(formatEfficiency(null)).toBe("-");
  });

  it("renders a percentage", () => {
    expect(formatEfficiency(80)).toBe("80%");
    expect(formatEfficiency(50.09, 1)).toBe("50.1%");
  });
});

describe("duration conversions (§15)", () => {
  it("stores 8 hours as 480 minutes", () => {
    expect(hoursToMinutes(8)).toBe(480);
  });

  it("stores 1.5 hours as 90 minutes", () => {
    expect(hoursToMinutes(1.5)).toBe(90);
  });

  it("rounds fractional hours to whole minutes", () => {
    // 0.1h = 6 minutes exactly
    expect(hoursToMinutes(0.1)).toBe(6);
    // 0.01h = 0.6 min -> rounds to 1, never stored as a float
    expect(hoursToMinutes(0.01)).toBe(1);
    expect(Number.isInteger(hoursToMinutes(2.7))).toBe(true);
  });

  it("round-trips whole hours", () => {
    expect(minutesToHours(hoursToMinutes(7.5))).toBe(7.5);
  });

  it("converts seconds to minutes", () => {
    expect(secondsToMinutes(3600)).toBe(60);
    expect(secondsToMinutes(90)).toBe(2); // rounds to nearest
  });

  it("rejects negative durations", () => {
    expect(() => hoursToMinutes(-1)).toThrow(RangeError);
  });
});

describe("formatMinutes", () => {
  it("formats hours and minutes", () => {
    expect(formatMinutes(450)).toBe("7h 30m");
    expect(formatMinutes(480)).toBe("8h");
    expect(formatMinutes(45)).toBe("45m");
    expect(formatMinutes(0)).toBe("0m");
  });
});
