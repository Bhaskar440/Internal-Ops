import Link from "next/link";
import { checkGlobal } from "@/lib/permissions/guard";
import { AccessDenied } from "@/components/layout/AccessDenied";
import { listAuditEntries, listAuditActions } from "@/modules/audit/audit.service";
import { PageHeader, Card, EmptyState, Badge } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";

export const dynamic = "force-dynamic";
export const metadata = { title: "Audit log" };

/** Actions that change money or pay, highlighted so they stand out. */
const FINANCIAL = new Set([
  "PAY_RATE_CHANGED",
  "PAYROLL_GENERATED",
  "PAYROLL_LOCKED",
  "PAYROLL_VOIDED",
  "PAYROLL_MARKED_PAID",
]);

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ action?: string; entityType?: string; page?: string }>;
}) {
  const params = await searchParams;
  const access = await checkGlobal("audit:read");
  if (!access.allowed) return <AccessDenied area="the audit log" />;
  const actor = access.actor;

  const [{ entries, total, page, pageSize }, actions] = await Promise.all([
    listAuditEntries(actor, {
      action: params.action,
      entityType: params.entityType,
      page: params.page ? Number(params.page) : 1,
    }),
    listAuditActions(actor),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <>
      <PageHeader
        title="Audit log"
        description="Every sensitive change, written in the same transaction as the change itself."
      />

      <Card className="mb-4">
        <form className="flex flex-wrap items-end gap-3 p-4">
          <div>
            <label
              htmlFor="action"
              className="mb-1.5 block text-xs font-medium text-zinc-600 dark:text-zinc-400"
            >
              Action
            </label>
            <select
              id="action"
              name="action"
              defaultValue={params.action ?? ""}
              className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            >
              <option value="">All actions</option>
              {actions.map((a) => (
                <option key={a} value={a}>
                  {a.replace(/_/g, " ").toLowerCase()}
                </option>
              ))}
            </select>
          </div>
          <Button variant="secondary" type="submit">
            Apply
          </Button>
          {(params.action || params.entityType) && (
            <Link
              href="/audit"
              className="px-2 py-2 text-sm text-zinc-600 hover:underline dark:text-zinc-400"
            >
              Clear
            </Link>
          )}
          <div className="flex-1" />
          <span className="py-2 text-sm text-zinc-500 dark:text-zinc-400">
            {total} {total === 1 ? "entry" : "entries"}
          </span>
        </form>
      </Card>

      {entries.length === 0 ? (
        <EmptyState
          title="No audit entries"
          description="Sensitive actions such as rate changes, approvals and payroll locks appear here."
        />
      ) : (
        <>
          <div className="space-y-2">
            {entries.map((e) => (
              <Card key={e.id}>
                <div className="p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={FINANCIAL.has(e.action) ? "amber" : "neutral"}>
                      {e.action.replace(/_/g, " ").toLowerCase()}
                    </Badge>
                    <span className="text-sm text-zinc-600 dark:text-zinc-400">
                      {e.entityType}
                    </span>
                    <div className="flex-1" />
                    <span className="text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
                      {e.createdAt.toISOString().replace("T", " ").slice(0, 19)} UTC
                    </span>
                  </div>

                  <div className="mt-1.5 text-sm text-zinc-700 dark:text-zinc-300">
                    {e.actorName ?? "System"}
                    {e.reason && (
                      <span className="ml-2 italic text-zinc-500 dark:text-zinc-400">
                        {e.reason}
                      </span>
                    )}
                  </div>

                  {(e.before != null || e.after != null) && (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-xs text-blue-600 dark:text-blue-400">
                        Show change
                      </summary>
                      <div className="mt-2 grid gap-2 sm:grid-cols-2">
                        {e.before != null && (
                          <div>
                            <div className="mb-1 text-xs font-medium text-zinc-500 dark:text-zinc-400">
                              Before
                            </div>
                            <pre className="overflow-x-auto rounded bg-zinc-100 p-2 text-xs dark:bg-zinc-800">
                              {String(JSON.stringify(e.before, null, 2))}
                            </pre>
                          </div>
                        )}
                        {e.after != null && (
                          <div>
                            <div className="mb-1 text-xs font-medium text-zinc-500 dark:text-zinc-400">
                              After
                            </div>
                            <pre className="overflow-x-auto rounded bg-zinc-100 p-2 text-xs dark:bg-zinc-800">
                              {String(JSON.stringify(e.after, null, 2))}
                            </pre>
                          </div>
                        )}
                      </div>
                    </details>
                  )}
                </div>
              </Card>
            ))}
          </div>

          {totalPages > 1 && (
            <nav className="mt-4 flex items-center justify-between">
              <span className="text-sm text-zinc-500 dark:text-zinc-400">
                Page {page} of {totalPages}
              </span>
              <div className="flex gap-2">
                {page > 1 && (
                  <Link href={`/audit?page=${page - 1}${params.action ? `&action=${params.action}` : ""}`}>
                    <Button variant="secondary">Previous</Button>
                  </Link>
                )}
                {page < totalPages && (
                  <Link href={`/audit?page=${page + 1}${params.action ? `&action=${params.action}` : ""}`}>
                    <Button variant="secondary">Next</Button>
                  </Link>
                )}
              </div>
            </nav>
          )}
        </>
      )}
    </>
  );
}
