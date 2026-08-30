import Link from "next/link";
import { requireActiveActor } from "@/lib/auth/actor";
import { listVentures } from "@/modules/ventures/venture.service";
import { listPeople, listPendingRegistrations } from "@/modules/people/person.service";
import {
  portfolioSummary,
  hoursToday,
  venturePerformance,
  attendanceSnapshot,
  workloadSnapshot,
} from "@/modules/reports/report.service";
import { listPendingApprovals, listMissingSubmissions } from "@/modules/dailyLogs/dailyLog.service";
import { expiringDocuments } from "@/modules/hr/hr.service";
import { isSuperAdmin } from "@/lib/permissions/types";
import { Card, PageHeader, EmptyState, Badge } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { formatMinutes, formatEfficiency } from "@/lib/money/efficiency";
import { DashboardFilters } from "./DashboardFilters";

export const dynamic = "force-dynamic";
export const metadata = { title: "Overview" };

/**
 * Admin dashboard (§9).
 *
 * Shows what needs action now: the four KPI cards, venture performance, and a
 * "needs attention" list that links straight through to the work.
 */
export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ venture?: string }>;
}) {
  const params = await searchParams;
  const actor = await requireActiveActor();
  const admin = isSuperAdmin(actor);
  const isManager = admin || [...actor.memberships.values()].includes("MANAGER");

  const [ventures, people, pending, summary, todayMinutes, performance, approvals, missing, docs] =
    await Promise.all([
      listVentures(actor),
      listPeople(actor),
      admin ? listPendingRegistrations(actor) : Promise.resolve([]),
      portfolioSummary(actor),
      hoursToday(actor),
      venturePerformance(actor, { ventureId: params.venture }),
      isManager ? listPendingApprovals(actor) : Promise.resolve([]),
      isManager ? listMissingSubmissions(actor) : Promise.resolve([]),
      admin ? expiringDocuments(actor) : Promise.resolve([]),
    ]);

  const [attendance, workload] = await Promise.all([
    attendanceSnapshot(actor),
    workloadSnapshot(actor),
  ]);

  const activePeople = people.filter((p) => p.accountStatus === "ACTIVE").length;

  const attention = [
    missing.length > 0 && {
      label: `${missing.length} missing daily log${missing.length === 1 ? "" : "s"}`,
      detail: "People have not submitted for a finished working day.",
      href: "/approvals",
    },
    approvals.length > 0 && {
      label: `${approvals.length} timesheet${approvals.length === 1 ? "" : "s"} awaiting approval`,
      detail: "Approved hours are what payroll pays.",
      href: "/approvals",
    },
    summary.overdueTasks > 0 && {
      label: `${summary.overdueTasks} overdue task${summary.overdueTasks === 1 ? "" : "s"}`,
      detail: "Past their due date and not yet done.",
      href: "/tasks",
    },
    pending.length > 0 && {
      label: `${pending.length} account${pending.length === 1 ? "" : "s"} awaiting approval`,
      detail: "They cannot access any venture until approved.",
      href: "/people?status=PENDING",
    },
    docs.length > 0 && {
      label: `${docs.length} document${docs.length === 1 ? "" : "s"} expiring or expired`,
      detail: "Check the HR records.",
      href: "/hr",
    },
  ].filter(Boolean) as { label: string; detail: string; href: string }[];

  return (
    <>
      <PageHeader
        title={`Good day, ${actor.name.split(" ")[0]}`}
        description="Everything happening across your ventures, in one place."
        action={
          <div className="flex flex-wrap gap-2">
            <Link href="/my-day">
              <Button variant="secondary">My day</Button>
            </Link>
            {isManager && (
              <Link href="/tasks/new">
                <Button>Create task</Button>
              </Link>
            )}
          </div>
        }
      />

      <DashboardFilters
        ventures={ventures.map((v) => ({ id: v.id, name: v.name }))}
        selected={params.venture}
      />

      {/* KPI cards (§9) */}
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Open tasks" value={summary.openTasks} hint={`${summary.overdueTasks} overdue`} />
        <Stat label="Hours today" value={formatMinutes(todayMinutes)} />
        <Stat label="Efficiency" value={formatEfficiency(summary.efficiency)} hint="completed tasks" />
        <Stat
          label="Missing logs"
          value={missing.length}
          tone={missing.length > 0 ? "warn" : undefined}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Venture performance */}
        <section className="lg:col-span-2">
          <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Ventures at a glance
          </h2>

          {performance.length === 0 ? (
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
            <div className="space-y-2">
              {performance.map((v) => (
                <Card key={v.ventureId}>
                  <div className="flex flex-wrap items-center gap-3 p-4">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: v.tagColor }}
                      aria-hidden
                    />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-zinc-900 dark:text-zinc-100">
                        {v.ventureName}
                      </div>
                      <div className="text-xs text-zinc-500 dark:text-zinc-400">
                        {v.tasksOpen} open · {v.tasksCompleted} done
                        {v.actualMinutes > 0 && ` · ${formatMinutes(v.actualMinutes)} logged`}
                      </div>
                    </div>
                    {v.tasksOverdue > 0 && <Badge tone="red">{v.tasksOverdue} overdue</Badge>}
                    <span className="tabular-nums text-sm font-medium text-zinc-900 dark:text-zinc-100">
                      {formatEfficiency(v.efficiency)}
                    </span>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </section>

        {/* Needs attention (§9) */}
        <section>
          <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Needs attention
          </h2>

          {attention.length === 0 ? (
            <Card>
              <div className="p-5 text-center">
                <div className="mb-1 text-2xl">✓</div>
                <p className="text-sm text-zinc-600 dark:text-zinc-400">
                  Nothing needs your attention.
                </p>
              </div>
            </Card>
          ) : (
            <div className="space-y-2">
              {attention.map((a) => (
                <Card key={a.label}>
                  <Link
                    href={a.href}
                    className="block p-4 hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                  >
                    <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                      {a.label}
                    </div>
                    <div className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                      {a.detail}
                    </div>
                  </Link>
                </Card>
              ))}
            </div>
          )}

          <div className="mt-4 rounded-xl border border-zinc-200 p-4 text-sm dark:border-zinc-800">
            <div className="flex justify-between py-1">
              <span className="text-zinc-500 dark:text-zinc-400">Ventures</span>
              <span className="tabular-nums text-zinc-900 dark:text-zinc-100">
                {ventures.length}
              </span>
            </div>
            <div className="flex justify-between py-1">
              <span className="text-zinc-500 dark:text-zinc-400">Active people</span>
              <span className="tabular-nums text-zinc-900 dark:text-zinc-100">
                {activePeople}
              </span>
            </div>
          </div>
        </section>
      </div>

      {/* Attendance and workload (§9) */}
      <div className="mt-8 grid gap-6 lg:grid-cols-3">
        <section>
          <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Today&rsquo;s attendance
          </h2>
          <Card>
            <div className="p-4">
              {attendance.totalExpected === 0 ? (
                <p className="py-4 text-center text-sm text-zinc-500 dark:text-zinc-400">
                  Nobody is assigned to a venture yet.
                </p>
              ) : (
                <ul className="space-y-2">
                  <AttendanceRow
                    label="Present"
                    count={attendance.present}
                    total={attendance.totalExpected}
                    tone="bg-green-500"
                  />
                  <AttendanceRow
                    label="Remote"
                    count={attendance.remote}
                    total={attendance.totalExpected}
                    tone="bg-blue-500"
                  />
                  <AttendanceRow
                    label="On leave"
                    count={attendance.onLeave}
                    total={attendance.totalExpected}
                    tone="bg-zinc-400"
                  />
                  <AttendanceRow
                    label="Absent"
                    count={attendance.absent}
                    total={attendance.totalExpected}
                    tone="bg-red-500"
                  />
                  <AttendanceRow
                    label="No submission"
                    count={attendance.noSubmission}
                    total={attendance.totalExpected}
                    tone="bg-amber-500"
                  />
                </ul>
              )}
            </div>
          </Card>
        </section>

        <section className="lg:col-span-2">
          <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Workload
          </h2>

          {workload.length === 0 ? (
            <EmptyState
              title="Nothing assigned"
              description="Workload appears once people are assigned to open tasks."
            />
          ) : (
            <Card>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[520px] text-sm">
                  <thead>
                    <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                      <th className="px-4 pb-2 pt-3 font-medium">Person</th>
                      <th className="px-4 pb-2 pt-3 font-medium">Venture</th>
                      <th className="px-4 pb-2 pt-3 text-right font-medium">Assigned</th>
                      <th className="px-4 pb-2 pt-3 text-right font-medium">Logged</th>
                      <th className="px-4 pb-2 pt-3 text-right font-medium">Capacity</th>
                    </tr>
                  </thead>
                  <tbody>
                    {workload.slice(0, 10).map((w) => (
                      <tr
                        key={w.personId}
                        className="border-b border-zinc-100 last:border-0 dark:border-zinc-800/60"
                      >
                        <td className="px-4 py-2.5">
                          <Link
                            href={`/people/${w.personId}?tab=work`}
                            className="text-zinc-900 hover:underline dark:text-zinc-100"
                          >
                            {w.personName}
                          </Link>
                        </td>
                        <td className="px-4 py-2.5 text-xs text-zinc-500 dark:text-zinc-400">
                          {w.ventureNames.join(", ")}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums">
                          {formatMinutes(w.assignedEstimateMinutes)}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums">
                          {formatMinutes(w.loggedMinutes)}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          {w.capacityPercent === null ? (
                            <span className="text-zinc-400">—</span>
                          ) : (
                            <span
                              className={
                                w.capacityPercent > 100
                                  ? "font-medium tabular-nums text-red-600 dark:text-red-400"
                                  : w.capacityPercent > 80
                                    ? "font-medium tabular-nums text-amber-600 dark:text-amber-400"
                                    : "tabular-nums text-zinc-600 dark:text-zinc-400"
                              }
                            >
                              {w.capacityPercent.toFixed(0)}%
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </section>
      </div>
    </>
  );
}

/** One attendance status with a proportional bar (§9). */
function AttendanceRow({
  label,
  count,
  total,
  tone,
}: {
  label: string;
  count: number;
  total: number;
  tone: string;
}) {
  // Drives the bar width only. The figure beside it is a count out of the
  // total, not a percentage: "3 of 5 people" is what a manager needs, and the
  // bar already carries the proportion.
  const pct = total === 0 ? 0 : (count / total) * 100;
  return (
    <li className="flex items-center gap-3 text-sm">
      <span className="w-28 shrink-0 text-zinc-600 dark:text-zinc-400">{label}</span>
      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
        <span
          className={`block h-full rounded-full ${tone}`}
          style={{ width: `${pct}%` }}
        />
      </span>
      <span className="w-16 shrink-0 text-right tabular-nums text-zinc-900 dark:text-zinc-100">
        {count}
        <span className="ml-1 text-xs text-zinc-400 dark:text-zinc-600">/ {total}</span>
      </span>
    </li>
  );
}

function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: number | string;
  hint?: string;
  tone?: "warn";
}) {
  return (
    <Card className={tone === "warn" ? "border-amber-300 dark:border-amber-900" : undefined}>
      <div className="p-4">
        <div className="text-2xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
          {value}
        </div>
        <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          {label}
          {hint && <span className="ml-1 text-zinc-400 dark:text-zinc-600">· {hint}</span>}
        </div>
      </div>
    </Card>
  );
}
