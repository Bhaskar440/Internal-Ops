import { requireActiveActor } from "@/lib/auth/actor";
import {
  listPendingApprovals,
  countPendingApprovals,
  listMissingSubmissions,
  APPROVAL_QUEUE_LIMIT,
} from "@/modules/dailyLogs/dailyLog.service";
import { isSuperAdmin } from "@/lib/permissions/types";
import { PageHeader, EmptyState, Card, Badge } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { formatMinutes } from "@/lib/money/efficiency";
import { approveLogAction, rejectLogAction } from "../my-day/actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Approvals" };

export default async function ApprovalsPage() {
  const actor = await requireActiveActor();

  const canReview =
    isSuperAdmin(actor) || [...actor.memberships.values()].includes("MANAGER");

  if (!canReview) {
    return (
      <>
        <PageHeader title="Approvals" />
        <EmptyState
          title="Nothing to review"
          description="Only venture managers and administrators review daily logs."
        />
      </>
    );
  }

  const [pending, totalPending, missing] = await Promise.all([
    listPendingApprovals(actor),
    countPendingApprovals(actor),
    listMissingSubmissions(actor),
  ]);

  // The queue shows a fixed number so one screen stays workable. If more are
  // waiting, say so — an unseen timesheet is an unpaid one.
  const queueTruncated = totalPending > pending.length;

  return (
    <>
      <PageHeader
        title="Approvals"
        description="Approved hours are what payroll pays. Review before approving."
      />

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Awaiting review ({totalPending})
        </h2>

        {queueTruncated && (
          <p className="mb-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
            Showing the {APPROVAL_QUEUE_LIMIT} oldest of {totalPending} submitted days.
            Approve or return some to see the rest.
          </p>
        )}

        {pending.length === 0 ? (
          <EmptyState title="No days awaiting review" />
        ) : (
          <div className="space-y-3">
            {pending.map((log) => (
              <Card key={log.id}>
                <div className="p-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: log.ventureTagColor }}
                      aria-hidden
                    />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-zinc-900 dark:text-zinc-100">
                        {log.personName}
                      </div>
                      <div className="text-xs text-zinc-500 dark:text-zinc-400">
                        {log.ventureName} · {log.businessDate} ·{" "}
                        {log.attendanceStatus.toLowerCase().replace("_", " ")}
                      </div>
                    </div>
                    <span className="tabular-nums text-sm font-medium text-zinc-900 dark:text-zinc-100">
                      {formatMinutes(log.totalMinutes)}
                    </span>
                    {log.attendanceConflict && <Badge tone="amber">attendance conflict</Badge>}
                  </div>

                  {log.entries.length > 0 && (
                    <ul className="mt-3 space-y-1 border-t border-zinc-200 pt-3 text-sm dark:border-zinc-800">
                      {log.entries.map((e) => (
                        <li key={e.id} className="flex items-center gap-2">
                          <span className="min-w-0 flex-1 truncate text-zinc-600 dark:text-zinc-400">
                            {e.taskTitle ?? "General work"}
                            {e.note && <span className="ml-2 text-xs">{e.note}</span>}
                          </span>
                          {e.approvalStatus === "NEEDS_REVIEW" && (
                            <Badge tone="amber">needs review</Badge>
                          )}
                          <span className="tabular-nums text-zinc-700 dark:text-zinc-300">
                            {formatMinutes(e.durationMinutes)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}

                  {log.generalNote && (
                    <p className="mt-2 text-sm italic text-zinc-600 dark:text-zinc-400">
                      “{log.generalNote}”
                    </p>
                  )}

                  <div className="mt-4 flex flex-wrap gap-2 border-t border-zinc-200 pt-3 dark:border-zinc-800">
                    <form action={approveLogAction}>
                      <input type="hidden" name="logId" value={log.id} />
                      <input type="hidden" name="ventureId" value={log.ventureId} />
                      <Button type="submit">Approve</Button>
                    </form>

                    <form action={rejectLogAction} className="flex flex-1 gap-2">
                      <input type="hidden" name="logId" value={log.id} />
                      <input type="hidden" name="ventureId" value={log.ventureId} />
                      <input
                        name="reason"
                        required
                        aria-label="Reason for returning this day"
                        placeholder="Reason for returning it"
                        className="min-w-40 flex-1 rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                      />
                      <Button variant="secondary" type="submit">
                        Return
                      </Button>
                    </form>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Missing submissions ({missing.length})
        </h2>
        <p className="mb-3 text-sm text-zinc-600 dark:text-zinc-400">
          People with no submitted log for a finished working day.
        </p>

        {missing.length === 0 ? (
          <EmptyState title="Everyone has submitted" />
        ) : (
          <Card>
            <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {missing.map((m) => (
                <li
                  key={`${m.personId}-${m.ventureId}-${m.businessDate}`}
                  className="flex items-center gap-3 px-4 py-2.5 text-sm"
                >
                  <span className="min-w-0 flex-1">
                    <span className="text-zinc-900 dark:text-zinc-100">{m.personName}</span>
                    <span className="ml-2 text-xs text-zinc-500 dark:text-zinc-400">
                      {m.ventureName}
                    </span>
                  </span>
                  <span className="tabular-nums text-xs text-zinc-500 dark:text-zinc-400">
                    {m.businessDate}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </section>
    </>
  );
}
