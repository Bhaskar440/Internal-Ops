import Link from "next/link";
import { requireActiveActor } from "@/lib/auth/actor";
import { listVentures } from "@/modules/ventures/venture.service";
import { listPeople, listPendingRegistrations } from "@/modules/people/person.service";
import { isSuperAdmin } from "@/lib/permissions/types";
import { Card, PageHeader, EmptyState, Badge } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";

export const dynamic = "force-dynamic";
export const metadata = { title: "Overview · Portfolio Ops" };

/**
 * Overview dashboard (§9).
 *
 * Phases 3-5 add the KPI cards that need tasks and time (open tasks, hours
 * today, efficiency, missing logs). What is shown here is only what the data
 * model can currently answer honestly — no placeholder numbers (§91 "no mock
 * data in production flow").
 */
export default async function OverviewPage() {
  const actor = await requireActiveActor();
  const admin = isSuperAdmin(actor);

  const [ventures, people, pending] = await Promise.all([
    listVentures(actor),
    listPeople(actor),
    admin ? listPendingRegistrations(actor) : Promise.resolve([]),
  ]);

  const activePeople = people.filter((p) => p.accountStatus === "ACTIVE").length;

  return (
    <>
      <PageHeader
        title={`Good day, ${actor.name.split(" ")[0]}`}
        description="Everything happening across your ventures, in one place."
        action={
          admin ? (
            <div className="flex gap-2">
              <Link href="/people/new">
                <Button variant="secondary">Add person</Button>
              </Link>
              <Link href="/ventures/new">
                <Button>Create venture</Button>
              </Link>
            </div>
          ) : undefined
        }
      />

      {pending.length > 0 && (
        <Card className="mb-6 border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30">
          <div className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div>
              <p className="font-medium text-amber-900 dark:text-amber-200">
                {pending.length} account{pending.length === 1 ? "" : "s"} awaiting approval
              </p>
              <p className="text-sm text-amber-800 dark:text-amber-300">
                People cannot access any venture until approved.
              </p>
            </div>
            <Link href="/people?status=PENDING">
              <Button variant="secondary">Review</Button>
            </Link>
          </div>
        </Card>
      )}

      <div className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Ventures" value={ventures.length} />
        <Stat label="Active people" value={activePeople} />
        <Stat label="Pending approvals" value={pending.length} />
        <Stat label="Open tasks" value="—" hint="Phase 3" />
      </div>

      <section>
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Ventures
        </h2>
        {ventures.length === 0 ? (
          <EmptyState
            title="No ventures yet"
            description={
              admin
                ? "Create your first venture to start assigning people and tasks."
                : "You have not been assigned to a venture yet."
            }
            action={
              admin ? (
                <Link href="/ventures/new">
                  <Button>Create venture</Button>
                </Link>
              ) : undefined
            }
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {ventures.map((v) => (
              <Card key={v.id}>
                <div className="p-4">
                  <div className="flex items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: v.tagColor }}
                      aria-hidden
                    />
                    <h3 className="font-medium text-zinc-900 dark:text-zinc-100">{v.name}</h3>
                  </div>
                  <dl className="mt-3 space-y-1 text-xs text-zinc-500 dark:text-zinc-400">
                    <div>{v.timezone}</div>
                    <div>
                      {v.defaultCurrency} · {v.workingDays.length}-day week ·{" "}
                      {v.dailyLogEditWindowHours}h edit window
                    </div>
                  </dl>
                  <div className="mt-3 flex items-center justify-between">
                    <Badge tone="blue">
                      {v.memberCount} {v.memberCount === 1 ? "person" : "people"}
                    </Badge>
                    {admin && (
                      <Link
                        href={`/ventures/${v.slug}`}
                        className="text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
                      >
                        Settings
                      </Link>
                    )}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>
    </>
  );
}

function Stat({ label, value, hint }: { label: string; value: number | string; hint?: string }) {
  return (
    <Card>
      <div className="p-4">
        <div className="text-2xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
          {value}
        </div>
        <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          {label}
          {hint && <span className="ml-1 text-zinc-400 dark:text-zinc-600">({hint})</span>}
        </div>
      </div>
    </Card>
  );
}
