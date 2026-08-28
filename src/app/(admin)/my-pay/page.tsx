import { requireActiveActor } from "@/lib/auth/actor";
import { prisma } from "@/lib/db/client";
import { isMyPayEnabled } from "@/modules/compensation/compensation.service";
import { Card, PageHeader, EmptyState, Badge } from "@/components/ui/Card";
import { formatMinutes } from "@/lib/money/efficiency";
import { fromPrismaDate } from "@/lib/timezone/businessDate";

export const dynamic = "force-dynamic";
export const metadata = { title: "My pay · Portfolio Ops" };

/**
 * My Pay (§57, §58).
 *
 * Shows a person their OWN approved hours and computed pay, and nothing else —
 * never another person's, never a portfolio total.
 *
 * Gated by FEATURE_MY_PAY_ENABLED (§88 item 10). While the flag is off the page
 * explains that rather than 404ing, so someone following a link is not left
 * wondering whether something is broken.
 */
export default async function MyPayPage() {
  const actor = await requireActiveActor();

  if (!isMyPayEnabled()) {
    return (
      <>
        <PageHeader title="My pay" />
        <EmptyState
          title="Pay details are not shown here"
          description="Your organisation has not enabled pay visibility in the portal. Your administrator or HR contact can tell you what you are owed."
        />
      </>
    );
  }

  if (!actor.personId) {
    return (
      <>
        <PageHeader title="My pay" />
        <EmptyState title="No personnel record" description="Ask an administrator to complete your profile." />
      </>
    );
  }

  // Only THIS person's payroll lines. The query is bound to actor.personId and
  // takes no id from the request, so there is nothing to tamper with.
  const lines = await prisma.payrollLine.findMany({
    where: {
      personId: actor.personId,
      run: { status: { in: ["LOCKED", "PAID"] } },
    },
    orderBy: { run: { periodStart: "desc" } },
    take: 24,
    select: {
      id: true,
      currency: true,
      approvedMinutes: true,
      computedPay: true,
      paymentStatus: true,
      paidAt: true,
      payTypeSnapshot: true,
      run: { select: { periodStart: true, periodEnd: true, status: true } },
    },
  });

  // Hours approved but not yet in a locked run — what is building up now.
  const pending = await prisma.timeEntry.aggregate({
    where: {
      personId: actor.personId,
      durationSeconds: { not: null },
      dailyLog: { status: "APPROVED" },
    },
    _sum: { durationSeconds: true },
  });
  const pendingMinutes = Math.round((pending._sum.durationSeconds ?? 0) / 60);

  return (
    <>
      <PageHeader
        title="My pay"
        description="Your approved hours and what they came to. Only you and an administrator can see this."
      />

      {pendingMinutes > 0 && (
        <Card className="mb-6">
          <div className="p-4">
            <div className="text-2xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
              {formatMinutes(pendingMinutes)}
            </div>
            <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              approved hours not yet in a locked payroll run
            </div>
          </div>
        </Card>
      )}

      {lines.length === 0 ? (
        <EmptyState
          title="No payroll history yet"
          description="Once a payroll run covering your hours is locked, it appears here."
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[600px] text-sm">
            <thead>
              <tr className="border-b border-zinc-300 text-left text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
                <th className="pb-2 pr-4 font-medium">Period</th>
                <th className="pb-2 pr-4 font-medium">Basis</th>
                <th className="pb-2 pr-4 text-right font-medium">Approved hours</th>
                <th className="pb-2 pr-4 text-right font-medium">Gross pay</th>
                <th className="pb-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.id} className="border-b border-zinc-200 dark:border-zinc-800">
                  <td className="py-2.5 pr-4 tabular-nums text-zinc-900 dark:text-zinc-100">
                    {fromPrismaDate(l.run.periodStart)} → {fromPrismaDate(l.run.periodEnd)}
                  </td>
                  <td className="py-2.5 pr-4 text-xs uppercase text-zinc-500 dark:text-zinc-400">
                    {l.payTypeSnapshot.replace("_", " ").toLowerCase()}
                  </td>
                  <td className="py-2.5 pr-4 text-right tabular-nums">
                    {formatMinutes(l.approvedMinutes)}
                  </td>
                  <td className="py-2.5 pr-4 text-right font-medium tabular-nums text-zinc-900 dark:text-zinc-100">
                    {l.currency} {Number(l.computedPay).toLocaleString()}
                  </td>
                  <td className="py-2.5">
                    <Badge tone={l.paymentStatus === "PAID" ? "green" : "amber"}>
                      {l.paymentStatus === "PAID"
                        ? `paid ${l.paidAt?.toISOString().slice(0, 10) ?? ""}`
                        : "unpaid"}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-6 max-w-2xl text-xs text-zinc-500 dark:text-zinc-400">
        Amounts are gross, before any deductions your payroll provider applies. If a figure
        looks wrong, raise it with your manager rather than editing past days — approved
        periods are locked deliberately.
      </p>
    </>
  );
}
