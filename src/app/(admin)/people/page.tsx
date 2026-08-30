import Link from "next/link";
import { requireActiveActor } from "@/lib/auth/actor";
import { listPeoplePaged } from "@/modules/people/person.service";
import { hoursReport } from "@/modules/reports/report.service";
import { formatMinutes } from "@/lib/money/efficiency";
import { listVentures } from "@/modules/ventures/venture.service";
import { isSuperAdmin } from "@/lib/permissions/types";
import { Card, PageHeader, EmptyState, Badge } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { setAccountStatusAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "People" };

const STATUS_TONE = {
  ACTIVE: "green",
  PENDING: "amber",
  SUSPENDED: "red",
  INACTIVE: "neutral",
} as const;

export default async function PeoplePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; venture?: string; status?: string; page?: string }>;
}) {
  const params = await searchParams;
  const actor = await requireActiveActor();
  const admin = isSuperAdmin(actor);

  const currentPage = params.page ? Math.max(1, Number(params.page)) : 1;

  const [result, ventures, hours] = await Promise.all([
    listPeoplePaged(actor, {
      search: params.q,
      ventureId: params.venture,
      page: currentPage,
    }),
    listVentures(actor),
    // Logged and approved hours, so the directory answers "who is this and what
    // have they done" in one place rather than sending you to Reports.
    hoursReport(actor, { ventureId: params.venture }),
  ]);

  // hoursReport returns a row per person PER VENTURE; the directory lists a
  // person once, so fold them together.
  const workByPerson = new Map<string, { minutes: number; approvedMinutes: number }>();
  for (const row of hours) {
    const acc = workByPerson.get(row.personId) ?? { minutes: 0, approvedMinutes: 0 };
    acc.minutes += row.minutes;
    acc.approvedMinutes += row.approvedMinutes;
    workByPerson.set(row.personId, acc);
  }

  const filtered = params.status
    ? result.people.filter((p) => p.accountStatus === params.status)
    : result.people;

  const hasFilters = Boolean(params.q || params.venture || params.status);
  const totalPages = Math.max(1, Math.ceil(result.total / result.pageSize));

  // Preserve the active filters when moving between pages.
  const pageQuery = (n: number) => {
    const q = new URLSearchParams();
    if (params.q) q.set("q", params.q);
    if (params.venture) q.set("venture", params.venture);
    if (params.status) q.set("status", params.status);
    q.set("page", String(n));
    return `/people?${q.toString()}`;
  };

  return (
    <>
      <PageHeader
        title="People"
        description={
          admin
            ? "Everyone across the portfolio. One person can belong to several ventures."
            : "People in your ventures."
        }
        action={
          admin ? (
            <Link href="/people/new">
              <Button>Add person</Button>
            </Link>
          ) : undefined
        }
      />

      <Card className="mb-4">
        <form className="flex flex-wrap items-end gap-3 p-4">
          <div className="min-w-48 flex-1">
            <label
              htmlFor="q"
              className="mb-1.5 block text-xs font-medium text-zinc-600 dark:text-zinc-400"
            >
              Search
            </label>
            <input
              id="q"
              name="q"
              defaultValue={params.q}
              placeholder="Name or email"
              className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            />
          </div>
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
              defaultValue={params.venture ?? ""}
              className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            >
              <option value="">All</option>
              {ventures.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label
              htmlFor="status"
              className="mb-1.5 block text-xs font-medium text-zinc-600 dark:text-zinc-400"
            >
              Status
            </label>
            <select
              id="status"
              name="status"
              defaultValue={params.status ?? ""}
              className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            >
              <option value="">Any</option>
              <option value="ACTIVE">Active</option>
              <option value="PENDING">Pending</option>
              <option value="SUSPENDED">Suspended</option>
              <option value="INACTIVE">Inactive</option>
            </select>
          </div>
          <Button variant="secondary" type="submit">
            Apply
          </Button>
          {hasFilters && (
            <Link
              href="/people"
              className="px-2 py-2 text-sm text-zinc-600 hover:underline dark:text-zinc-400"
            >
              Clear
            </Link>
          )}
        </form>
      </Card>

      {filtered.length === 0 ? (
        <EmptyState
          title="No people found"
          description={
            hasFilters
              ? "Try clearing the filters."
              : admin
                ? "Add your first person to get started."
                : "No one has been assigned to your ventures yet."
          }
          action={
            admin && !hasFilters ? (
              <Link href="/people/new">
                <Button>Add person</Button>
              </Link>
            ) : undefined
          }
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-separate border-spacing-0 text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                <th className="pb-2 pr-4 font-medium">Name</th>
                <th className="pb-2 pr-4 font-medium">Type</th>
                <th className="pb-2 pr-4 font-medium">Ventures</th>
                <th className="pb-2 pr-4 text-right font-medium">Logged</th>
                <th className="pb-2 pr-4 text-right font-medium">Approved</th>
                <th className="pb-2 pr-4 font-medium">Status</th>
                {admin && <th className="pb-2 font-medium">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr key={p.personId} className="border-t border-zinc-200 dark:border-zinc-800">
                  <td className="py-3 pr-4">
                    <Link
                      href={`/people/${p.personId}`}
                      className="font-medium text-zinc-900 hover:underline dark:text-zinc-100"
                    >
                      {p.name}
                    </Link>
                    <div className="text-xs text-zinc-500 dark:text-zinc-400">{p.email}</div>
                  </td>
                  <td className="py-3 pr-4 capitalize text-zinc-600 dark:text-zinc-400">
                    {p.employmentType.toLowerCase()}
                  </td>
                  <td className="py-3 pr-4">
                    <div className="flex flex-wrap gap-1">
                      {p.ventures.length === 0 ? (
                        <span className="text-xs text-zinc-400">None</span>
                      ) : (
                        p.ventures.map((v) => (
                          <span
                            key={v.id}
                            className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2 py-0.5 text-xs dark:bg-zinc-800"
                          >
                            <span
                              className="h-1.5 w-1.5 rounded-full"
                              style={{ backgroundColor: v.tagColor }}
                              aria-hidden
                            />
                            {v.name}
                            {v.accessRole === "MANAGER" && (
                              <span className="text-[10px] font-semibold text-blue-600 dark:text-blue-400">
                                MGR
                              </span>
                            )}
                          </span>
                        ))
                      )}
                    </div>
                  </td>
                  <td className="py-3 pr-4 text-right tabular-nums text-zinc-600 dark:text-zinc-400">
                    {workByPerson.get(p.personId)?.minutes
                      ? formatMinutes(workByPerson.get(p.personId)!.minutes)
                      : "—"}
                  </td>
                  <td className="py-3 pr-4 text-right tabular-nums text-zinc-900 dark:text-zinc-100">
                    {workByPerson.get(p.personId)?.approvedMinutes
                      ? formatMinutes(workByPerson.get(p.personId)!.approvedMinutes)
                      : "—"}
                  </td>
                  <td className="py-3 pr-4">
                    <Badge
                      tone={STATUS_TONE[p.accountStatus as keyof typeof STATUS_TONE] ?? "neutral"}
                    >
                      {p.accountStatus.toLowerCase()}
                    </Badge>
                  </td>
                  {admin && (
                    <td className="py-3">
                      {p.accountStatus === "PENDING" ? (
                        <form action={setAccountStatusAction}>
                          <input type="hidden" name="userId" value={p.userId} />
                          <input type="hidden" name="status" value="ACTIVE" />
                          <Button type="submit" className="px-3 py-1 text-xs">
                            Approve
                          </Button>
                        </form>
                      ) : p.accountStatus === "ACTIVE" ? (
                        <form action={setAccountStatusAction}>
                          <input type="hidden" name="userId" value={p.userId} />
                          <input type="hidden" name="status" value="SUSPENDED" />
                          <Button
                            variant="ghost"
                            type="submit"
                            className="px-3 py-1 text-xs text-red-600 dark:text-red-400"
                          >
                            Suspend
                          </Button>
                        </form>
                      ) : (
                        <form action={setAccountStatusAction}>
                          <input type="hidden" name="userId" value={p.userId} />
                          <input type="hidden" name="status" value="ACTIVE" />
                          <Button variant="ghost" type="submit" className="px-3 py-1 text-xs">
                            Reactivate
                          </Button>
                        </form>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>

          {totalPages > 1 && (
            <nav
              aria-label="Pagination"
              className="mt-4 flex items-center justify-between"
            >
              <span className="text-sm text-zinc-500 dark:text-zinc-400">
                Page {result.page} of {totalPages} · {result.total} people
              </span>
              <div className="flex gap-2">
                {result.page > 1 && (
                  <Link href={pageQuery(result.page - 1)}>
                    <Button variant="secondary">Previous</Button>
                  </Link>
                )}
                {result.page < totalPages && (
                  <Link href={pageQuery(result.page + 1)}>
                    <Button variant="secondary">Next</Button>
                  </Link>
                )}
              </div>
            </nav>
          )}
        </div>
      )}
    </>
  );
}
