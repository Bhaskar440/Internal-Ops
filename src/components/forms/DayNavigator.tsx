"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { DATE_MIN } from "@/components/ui/Field";

/**
 * Move between days in My Day.
 *
 * Each business date is its own log, so a day someone forgot to fill in is not
 * lost — but without this there was no way to reach it from the interface.
 * Whether an older day can still be edited is the venture's edit window, which
 * the server decides; this only navigates.
 */
export function DayNavigator({
  businessDate,
  today,
}: {
  /** The day being shown, `YYYY-MM-DD`. */
  businessDate: string;
  /** Today in the venture's timezone, so "Today" is not the browser's idea of it. */
  today: string;
}) {
  const router = useRouter();

  const go = (date: string) => {
    // Today is the default view, so it needs no query string.
    router.push(date === today ? "/my-day" : `/my-day?date=${date}`);
  };

  const shift = (days: number) => {
    const d = new Date(`${businessDate}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    go(d.toISOString().slice(0, 10));
  };

  const isToday = businessDate === today;

  return (
    <div className="mb-5 flex flex-wrap items-center gap-2">
      <Button
        variant="secondary"
        type="button"
        onClick={() => shift(-1)}
        aria-label="Previous day"
      >
        ←
      </Button>

      <input
        type="date"
        value={businessDate}
        min={DATE_MIN}
        max={today}
        onChange={(e) => e.target.value && go(e.target.value)}
        aria-label="Show a different day"
        className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
      />

      <Button
        variant="secondary"
        type="button"
        onClick={() => shift(1)}
        // A day that has not happened cannot be filled in.
        disabled={isToday}
        aria-label="Next day"
      >
        →
      </Button>

      {!isToday && (
        <Button variant="secondary" type="button" onClick={() => go(today)}>
          Today
        </Button>
      )}
    </div>
  );
}
