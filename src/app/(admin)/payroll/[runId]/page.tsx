import Link from "next/link";
import { notFound } from "next/navigation";
import { requireGlobal } from "@/lib/permissions/guard";
import { getRun, findExceptions } from "@/modules/payroll/payroll.service";
import { isAppError } from "@/lib/errors/appError";
import { PageHeader, Card, EmptyState, Badge } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { formatMinutes } from "@/lib/money/efficiency";
import {
  generateLinesAction,
  lockRunAction,
  voidRunAction,
  markPaidAction,
} from "../actions";

export const dynamic = "force-dynamic";

const STATUS_TONE: Record<string, "neutral" | "green" | "amber" | "red" | "blue"> = {
  DRAFT: "neutral",
  REVIEW: "amber",
  LOCKED: "blue",
  PAID: "green",
  VOID: "red",
};

export default async function PayrollRunPage({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  const { runId } = await params;
  const actor = await requireGlobal("payroll:read");

  let run;
  try {
    run = await getRun(actor, runId);
  } catch (e) {
    if (isAppError(e) && e.code === "NOT_FOUND") notFound();
    throw e;
  }

  // Exceptions only matter while the run can still change.
  const exceptions =
    run.status === "DRAFT" || run.status === "REVIEW"
      ? await findExceptions(actor, runId)
      : [];

  const editable = run.status === "DRAFT" || run.status === "REVIEW";
  const locked = run.status === "LOCKED" || run.status === "PAID";

  return (
    <>
      <PageHeader
        title={`${run.periodStart} → ${run.periodEnd}`}
        description="Gross payable amounts. Payment happens in your external system."
        action={
          <div className="flex items-center gap-3">
            <Badge tone={STATUS_TONE[run.status] ?? "neutral"}>{run.status.toLowerCase()}</Badge>
            <Link
              href="/payroll"
              className="text-sm text-zinc-600 hover:underline dark:text-zinc-400"
            >
              All runs
            </Link>
          </div>
        }
      />

      {/* Totals, kept separate per currency */}
      {run.totalsByCurrency.length > 0 && (
        <div className="mb-6 grid gap-3 sm:grid-cols-3">
          {run.totalsByCurrency.map((t) => (
            <Card key={t.currency}>
              <div className="p-4">
                <div className="text-2xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
                  {t.currency} {Number(t.total).toLocaleString()}
                </div>
                <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                  {t.lineCount} {t.lineCount === 1 ? "person" : "people"}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {exceptions.length > 0 && (
        <Card className="mb-6 border-amber-300 dark:border-amber-900">
          <div className="p-5">
            <h2 className="font-medium text-amber-900 dark:text-amber-200">
              {exceptions.length} exception{exceptions.length === 1 ? "" : "s"} to resolve
            </h2>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
              Resolve these before locking, or the amounts may be wrong.
            </p>
            <ul className="mt-3 space-y-2">
              {exceptions.map((ex, i) => (
                <li
                  key={`${ex.personId}-${ex.type}-${i}`}
                  className="flex flex-wrap items-center gap-2 text-sm"
                >
                  <span className="font-medium text-zinc-900 dark:text-zinc-100">
                    {ex.personName}
                  </span>
                  <Badge tone="amber">{ex.type.replace(/_/g, " ").toLowerCase()}</Badge>
                  <span className="text-zinc-600 dark:text-zinc-400">{ex.detail}</span>
                </li>
              ))}
            </ul>
          </div>
        </Card>
      )}

      {/* Actions */}
      <div className="mb-6 flex flex-wrap gap-2">
        {editable && (
          <form action={generateLinesAction}>
            <input type="hidden" name="runId" value={run.id} />
            <Button type="submit">
              {run.lines.length === 0 ? "Generate lines" : "Recalculate"}
            </Button>
          </form>
        )}

        {run.status === "REVIEW" && run.lines.length > 0 && (
          <form action={lockRunAction}>
            <input type="hidden" name="runId" value={run.id} />
            <Button variant="secondary" type="submit">
              Lock run
            </Button>
          </form>
        )}

        {locked && (
          <Link href={`/api/payroll/${run.id}/export`}>
            <Button variant="secondary">Export CSV</Button>
          </Link>
        )}

        {editable && (
          <form action={voidRunAction} className="flex flex-1 gap-2">
            <input type="hidden" name="runId" value={run.id} />
            <input
              name="reason"
              required
              placeholder="Reason for voiding this run"
              className="min-w-40 flex-1 rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            />
            <Button variant="danger" type="submit">
              Void
            </Button>
          </form>
        )}
      </div>

      {run.lines.length === 0 ? (
        <EmptyState
          title="No payroll lines yet"
          description="Generate the lines to calculate what each person is owed for this period."
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="border-b border-zinc-300 text-left text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
                <th className="pb-2 pr-4 font-medium">Person</th>
                <th className="pb-2 pr-4 font-medium">Pay type</th>
                <th className="pb-2 pr-4 text-right font-medium">Approved hours</th>
                <th className="pb-2 pr-4 text-right font-medium">Days</th>
                <th className="pb-2 pr-4 text-right font-medium">Rate</th>
                <th className="pb-2 pr-4 text-right font-medium">Gross pay</th>
                <th className="pb-2 font-medium">Payment</th>
              </tr>
            </thead>
            <tbody>
              {run.lines.map((line) => (
                <tr key={line.id} className="border-b border-zinc-200 dark:border-zinc-800">
                  <td className="py-2.5 pr-4 text-zinc-900 dark:text-zinc-100">
                    {line.personName}
                  </td>
                  <td className="py-2.5 pr-4 text-xs uppercase text-zinc-500 dark:text-zinc-400">
                    {line.payType.replace("_", " ").toLowerCase()}
                  </td>
                  <td className="py-2.5 pr-4 text-right tabular-nums">
                    {formatMinutes(line.approvedMinutes)}
                  </td>
                  <td className="py-2.5 pr-4 text-right tabular-nums text-zinc-500 dark:text-zinc-400">
                    {line.eligibleDays ?? "—"}
                    {line.workingDays ? ` / ${line.workingDays}` : ""}
                  </td>
                  <td className="py-2.5 pr-4 text-right tabular-nums text-zinc-600 dark:text-zinc-400">
                    {line.currency} {Number(line.rate).toLocaleString()}
                  </td>
                  <td className="py-2.5 pr-4 text-right font-medium tabular-nums text-zinc-900 dark:text-zinc-100">
                    {line.currency} {Number(line.computedPay).toLocaleString()}
                  </td>
                  <td className="py-2.5">
                    {line.paymentStatus === "PAID" ? (
                      <Badge tone="green">paid</Badge>
                    ) : locked ? (
                      <form action={markPaidAction} className="flex gap-1">
                        <input type="hidden" name="lineId" value={line.id} />
                        <input type="hidden" name="runId" value={run.id} />
                        <input
                          name="reference"
                          placeholder="Reference"
                          className="w-24 rounded-md border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900"
                        />
                        <Button type="submit" className="px-2 py-1 text-xs">
                          Mark paid
                        </Button>
                      </form>
                    ) : (
                      <span className="text-xs text-zinc-400">lock first</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
