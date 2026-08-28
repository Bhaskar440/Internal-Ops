import { cn } from "@/lib/utils/cn";

/**
 * Loading placeholders (§71).
 *
 * Shapes roughly match the content they stand in for, so the page does not
 * jump when real data arrives.
 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "animate-pulse rounded bg-zinc-200 dark:bg-zinc-800",
        className,
      )}
      aria-hidden
    />
  );
}

export function SkeletonPage({
  cards = 3,
  withStats = false,
}: {
  cards?: number;
  withStats?: boolean;
}) {
  return (
    <div role="status" aria-label="Loading">
      <div className="mb-6">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="mt-2 h-4 w-80" />
      </div>

      {withStats && (
        <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
      )}

      <div className="space-y-3">
        {Array.from({ length: cards }).map((_, i) => (
          <Skeleton key={i} className="h-20 rounded-xl" />
        ))}
      </div>

      <span className="sr-only">Loading…</span>
    </div>
  );
}

export function SkeletonTable({ rows = 6 }: { rows?: number }) {
  return (
    <div role="status" aria-label="Loading">
      <div className="mb-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="mt-2 h-4 w-72" />
      </div>
      <Skeleton className="mb-4 h-16 rounded-xl" />
      <div className="space-y-2">
        {Array.from({ length: rows }).map((_, i) => (
          <Skeleton key={i} className="h-12 rounded" />
        ))}
      </div>
      <span className="sr-only">Loading…</span>
    </div>
  );
}
