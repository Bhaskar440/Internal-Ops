import Link from "next/link";
import { Button } from "@/components/ui/Button";

/**
 * Dashboard venture filter (§9).
 *
 * A plain GET form, so the choice lands in the URL and the view can be shared
 * or bookmarked (§60), and the page stays a server component.
 */
export function DashboardFilters({
  ventures,
  selected,
}: {
  ventures: { id: string; name: string }[];
  selected?: string;
}) {
  if (ventures.length < 2) return null;

  return (
    <form className="mb-6 flex flex-wrap items-end gap-3">
      <div>
        <label
          htmlFor="venture"
          className="mb-1.5 block text-xs font-medium text-zinc-600 dark:text-zinc-400"
        >
          Venture
        </label>
        <select
          id="venture"
          name="venture"
          defaultValue={selected ?? ""}
          className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        >
          <option value="">All ventures</option>
          {ventures.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </select>
      </div>

      <Button variant="secondary" type="submit">
        Apply
      </Button>

      {selected && (
        <Link
          href="/"
          className="px-2 py-2 text-sm text-zinc-600 hover:underline dark:text-zinc-400"
        >
          Clear
        </Link>
      )}
    </form>
  );
}
