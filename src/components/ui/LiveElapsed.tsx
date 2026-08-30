"use client";

import { useEffect, useState } from "react";

/**
 * Elapsed time for a running timer, counting up once per second.
 *
 * Rendered on the server as a placeholder and only started once mounted: the
 * server and the browser render at different instants, so any real clock value
 * emitted during SSR would differ from the first client render and trip a
 * hydration mismatch.
 *
 * The count is derived from `startedAt` on every tick rather than incremented,
 * so a backgrounded tab (where timers are throttled) shows the correct total
 * when it returns instead of a figure that has silently fallen behind.
 */
export function LiveElapsed({
  startedAt,
  className,
}: {
  /** ISO timestamp of when the timer started. */
  startedAt: string;
  className?: string;
}) {
  const [elapsed, setElapsed] = useState<number | null>(null);

  useEffect(() => {
    const start = new Date(startedAt).getTime();
    if (Number.isNaN(start)) return;

    const tick = () => setElapsed(Math.max(0, Math.floor((Date.now() - start) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [startedAt]);

  return (
    <span
      className={className}
      // Announced as a whole when it changes, rather than digit by digit.
      aria-live="off"
      title="Running"
    >
      {elapsed === null ? "running…" : formatElapsed(elapsed)}
    </span>
  );
}

/** `h:mm:ss` past an hour, `m:ss` below it. */
function formatElapsed(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
