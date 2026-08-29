import Link from "next/link";
import { checkGlobal } from "@/lib/permissions/guard";
import { AccessDenied } from "@/components/layout/AccessDenied";
import { listAdjustments } from "@/modules/payroll/payroll.service";
import { listPeople } from "@/modules/people/person.service";
import { listVentures } from "@/modules/ventures/venture.service";
import { Card, PageHeader, EmptyState, Badge } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { AdjustmentForm } from "./AdjustmentForm";
import { cancelAdjustmentAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Payroll adjustments" };

/**
 * Post-payroll corrections (§43).
 *
 * Paid payroll is never rewritten. A correction recorded here settles forward
 * into the person's next payroll run, so the paid snapshot and its audit trail
 * both stay intact.
 */
export default async function AdjustmentsPage() {
  const access = await checkGlobal("payroll:read");
  if (!access.allowed) return <AccessDenied area="payroll" />;
  const actor = access.actor;

  const [adjustments, people, ventures] = await Promise.all([
    listAdjustments(actor),
    listPeople(actor),
    listVentures(actor),
  ]);

  const outstanding = adjustments.filter((a) => !a.settled);
  const settled = adjustments.filter((a) => a.settled);

  return (
    <>
      <PageHeader
        title="Payroll adjustments"
        description="Corrections to payroll that has already been paid. Each one settles into that person's next run."
        action={
          <Link href="/payroll" className="text-sm text-zinc-600 hover:underline dark:text-zinc-400">
            Back to payroll
          </Link>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <section>
            <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              Outstanding ({outstanding.length})
            </h2>

            {outstanding.length === 0 ? (
              <EmptyState
                title="No outstanding adjustments"
                description="Corrections raised here are applied automatically to the next payroll run."
              />
            ) : (
              <div className="space-y-2">
                {outstanding.map((a) => (
                  <Card key={a.id}>
                    <div className="p-4">
                      <div className="flex flex-wrap items-center gap-3">
                        <span className="font-medium text-zinc-900 dark:text-zinc-100">
                          {a.personName}
                        </span>
                        <span
                          className={`tabular-nums font-medium ${
                            Number(a.amount) >= 0
                              ? "text-green-700 dark:text-green-400"
                              : "text-red-700 dark:text-red-400"
                          }`}
                        >
                          {Number(a.amount) >= 0 ? "+" : "−"}
                          {a.currency} {Math.abs(Number(a.amount)).toLocaleString()}
                        </span>
                        <div className="flex-1" />
                        <Badge tone="amber">settles next run</Badge>
                      </div>

                      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{a.reason}</p>

                      {a.sourcePeriod && (
                        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                          Against the paid run for {a.sourcePeriod}
                        </p>
                      )}

                      <form
                        action={cancelAdjustmentAction}
                        className="mt-3 flex flex-wrap gap-2 border-t border-zinc-200 pt-3 dark:border-zinc-800"
                      >
                        <input type="hidden" name="adjustmentId" value={a.id} />
                        <input
                          name="reason"
                          required
                          aria-label="Reason for cancelling this adjustment"
                          placeholder="Reason for cancelling"
                          className="min-w-40 flex-1 rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                        />
                        <Button
                          variant="ghost"
                          type="submit"
                          className="px-3 py-1 text-xs text-red-600 dark:text-red-400"
                        >
                          Cancel adjustment
                        </Button>
                      </form>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </section>

          <section>
            <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              Settled ({settled.length})
            </h2>

            {settled.length === 0 ? (
              <EmptyState title="Nothing settled yet" />
            ) : (
              <div className="space-y-2">
                {settled.map((a) => (
                  <Card key={a.id} className="opacity-80">
                    <div className="flex flex-wrap items-center gap-3 p-4">
                      <span className="text-sm text-zinc-900 dark:text-zinc-100">
                        {a.personName}
                      </span>
                      <span className="tabular-nums text-sm text-zinc-600 dark:text-zinc-400">
                        {Number(a.amount) >= 0 ? "+" : "−"}
                        {a.currency} {Math.abs(Number(a.amount)).toLocaleString()}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-xs text-zinc-500 dark:text-zinc-400">
                        {a.reason}
                      </span>
                      <Badge tone="green">settled</Badge>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </section>
        </div>

        <div>
          <Card>
            <div className="p-5">
              <h2 className="mb-1 font-medium text-zinc-900 dark:text-zinc-100">
                Raise an adjustment
              </h2>
              <p className="mb-4 text-sm text-zinc-600 dark:text-zinc-400">
                Use this when payroll has already been <strong>paid</strong> and the amount was
                wrong. For an unpaid run, void it and generate a replacement instead.
              </p>
              <AdjustmentForm
                people={people.map((p) => ({ personId: p.personId, name: p.name }))}
                defaultCurrency={ventures[0]?.defaultCurrency ?? "INR"}
              />
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
