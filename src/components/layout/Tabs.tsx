import Link from "next/link";
import { cn } from "@/lib/utils/cn";

/**
 * URL-driven tabs.
 *
 * State lives in the query string rather than component state, so a tab can be
 * linked to and bookmarked (§60) and the page stays a server component.
 */
export function Tabs({
  tabs,
  active,
  hrefFor,
}: {
  tabs: { key: string; label: string; count?: number }[];
  active: string;
  hrefFor: (key: string) => string;
}) {
  return (
    <nav
      aria-label="Sections"
      className="mb-5 flex flex-wrap gap-1 border-b border-zinc-200 dark:border-zinc-800"
    >
      {tabs.map((t) => {
        const isActive = t.key === active;
        return (
          <Link
            key={t.key}
            href={hrefFor(t.key)}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm transition-colors",
              isActive
                ? "border-blue-600 font-medium text-blue-700 dark:border-blue-400 dark:text-blue-300"
                : "border-transparent text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100",
            )}
          >
            {t.label}
            {t.count !== undefined && t.count > 0 && (
              <span className="rounded-full bg-zinc-100 px-1.5 text-xs tabular-nums text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                {t.count}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
