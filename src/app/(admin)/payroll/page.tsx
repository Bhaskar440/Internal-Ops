import Link from "next/link";
import { checkGlobal } from "@/lib/permissions/guard";
import { AccessDenied } from "@/components/layout/AccessDenied";
import { listRuns } from "@/modules/payroll/payroll.service";
import { PageHeader, Card, EmptyState, Badge } from "@/components/ui/Card";
import { NewRunForm } from "./NewRunForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Payroll · Portfolio Ops" };

const STATUS_TONE: Record<string, "neutral" | "green" | "amber" | "red" | "blue"> = {
  DRAFT: "neutral",
  REVIEW: "amber",
  LOCKED: "blue",
  PAID: "green",
  VOID: "red",
};

export default async function PayrollPage() {
  const access = await checkGlobal("payroll:read");
  if (!access.allowed) return <AccessDenied area="payroll" />;
  const actor = access.actor;
  const runs = await listRuns(actor);

  const now = new Date();

  return (
    <>
      <PageHeader
        title="Payroll"
        description="Calculates gross payable amounts only. It does not move money or compute tax."
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Payroll runs
          </h2>

          {runs.length === 0 ? (
            <EmptyState
              title="No payroll run generated"
              description="Create a run for a pay period to calculate what is payable."
            />
          ) : (
            <div className="space-y-2">
              {runs.map((r) => (
                <Card key={r.id}>
                  <Link
                    href={`/payroll/${r.id}`}
                    className="flex flex-wrap items-center gap-3 p-4 hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-zinc-900 dark:text-zinc-100">
                        {r.periodStart} → {r.periodEnd}
                      </div>
                      <div className="text-xs text-zinc-500 dark:text-zinc-400">
                        {r.lineCount} {r.lineCount === 1 ? "line" : "lines"}
                        {r.lockedAt && ` · locked ${r.lockedAt.toISOString().slice(0, 10)}`}
                      </div>
                    </div>
                    <Badge tone={STATUS_TONE[r.status] ?? "neutral"}>
                      {r.status.toLowerCase()}
                    </Badge>
                  </Link>
                </Card>
              ))}
            </div>
          )}
        </div>

        <div>
          <Card>
            <div className="p-5">
              <h2 className="mb-1 font-medium text-zinc-900 dark:text-zinc-100">
                New payroll run
              </h2>
              <p className="mb-4 text-sm text-zinc-600 dark:text-zinc-400">
                Runs cover a calendar month.
              </p>
              <NewRunForm
                defaultYear={now.getUTCFullYear()}
                defaultMonth={now.getUTCMonth() + 1}
              />
            </div>
          </Card>

          <Card className="mt-4">
            <div className="p-5 text-sm text-zinc-600 dark:text-zinc-400">
              <h3 className="mb-2 font-medium text-zinc-900 dark:text-zinc-100">
                How a run works
              </h3>
              <ol className="list-inside list-decimal space-y-1">
                <li>Create the run for a period</li>
                <li>Resolve any exceptions</li>
                <li>Generate the lines</li>
                <li>Review the amounts</li>
                <li>Lock the run — the snapshot freezes</li>
                <li>Export CSV and pay externally</li>
                <li>Mark each line paid</li>
              </ol>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
