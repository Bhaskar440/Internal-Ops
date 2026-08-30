import Link from "next/link";
import { requireActiveActor } from "@/lib/auth/actor";
import {
  hoursReport,
  venturePerformance,
  personPerformance,
  taskEfficiencyReport,
} from "@/modules/reports/report.service";
import { listVentures } from "@/modules/ventures/venture.service";
import { isSuperAdmin } from "@/lib/permissions/types";
import { PageHeader, Card, EmptyState, Badge } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { formatMinutes, formatEfficiency } from "@/lib/money/efficiency";

export const dynamic = "force-dynamic";
export const metadata = { title: "Reports" };

const TABS = [
  { key: "hours", label: "Hours" },
  { key: "attendance", label: "Attendance" },
  { key: "ventures", label: "Venture performance" },
  { key: "people", label: "Person performance" },
  { key: "tasks", label: "Task efficiency" },
] as const;

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; venture?: string; from?: string; to?: string }>;
}) {
  const params = await searchParams;
  const actor = await requireActiveActor();

  const canReport =
    isSuperAdmin(actor) || [...actor.memberships.values()].includes("MANAGER");

  if (!canReport) {
    return (
      <>
        <PageHeader title="Reports" />
        <EmptyState
          title="Reports are not available to you"
          description="Only venture managers and administrators can view reporting."
        />
      </>
    );
  }

  const tab = TABS.find((t) => t.key === params.tab)?.key ?? "hours";
  const filters = { ventureId: params.venture, from: params.from, to: params.to };
  const ventures = await listVentures(actor);

  const query = new URLSearchParams();
  if (params.venture) query.set("venture", params.venture);
  if (params.from) query.set("from", params.from);
  if (params.to) query.set("to", params.to);

  return (
    <>
      <PageHeader
        title="Reports"
        description="Efficiency is total estimated over total actual — never an average of percentages."
        action={
          <Link href={`/api/reports/export?type=${tab}&${query.toString()}`}>
            <Button variant="secondary">Export CSV</Button>
          </Link>
        }
      />

      <Card className="mb-4">
        <form className="flex flex-wrap items-end gap-3 p-4">
          <input type="hidden" name="tab" value={tab} />
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
              htmlFor="from"
              className="mb-1.5 block text-xs font-medium text-zinc-600 dark:text-zinc-400"
            >
              From
            </label>
            <input
              id="from"
              name="from"
              type="date"
              defaultValue={params.from}
              className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            />
          </div>
          <div>
            <label
              htmlFor="to"
              className="mb-1.5 block text-xs font-medium text-zinc-600 dark:text-zinc-400"
            >
              To
            </label>
            <input
              id="to"
              name="to"
              type="date"
              defaultValue={params.to}
              className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            />
          </div>
          <Button variant="secondary" type="submit">
            Apply
          </Button>
        </form>
      </Card>

      <nav className="mb-4 flex flex-wrap gap-1 border-b border-zinc-200 dark:border-zinc-800">
        {TABS.map((t) => {
          const q = new URLSearchParams(query);
          q.set("tab", t.key);
          const active = t.key === tab;
          return (
            <Link
              key={t.key}
              href={`/reports?${q.toString()}`}
              className={`-mb-px border-b-2 px-3 py-2 text-sm ${
                active
                  ? "border-blue-600 font-medium text-blue-700 dark:border-blue-400 dark:text-blue-300"
                  : "border-transparent text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
              }`}
            >
              {t.label}
            </Link>
          );
        })}
      </nav>

      {tab === "hours" && <HoursTable actor={actor} filters={filters} />}
      {tab === "attendance" && <AttendanceTable actor={actor} filters={filters} />}
      {tab === "ventures" && <VentureTable actor={actor} filters={filters} />}
      {tab === "people" && <PeopleTable actor={actor} filters={filters} />}
      {tab === "tasks" && <TaskTable actor={actor} filters={filters} />}
    </>
  );
}

type Props = {
  actor: Awaited<ReturnType<typeof requireActiveActor>>;
  filters: { ventureId?: string; from?: string; to?: string };
};

async function HoursTable({ actor, filters }: Props) {
  const rows = await hoursReport(actor, filters);
  if (rows.length === 0) return <EmptyState title="No hours recorded for these filters" />;

  const totalApproved = rows.reduce((s, r) => s + r.approvedMinutes, 0);
  const total = rows.reduce((s, r) => s + r.minutes, 0);

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="border-b border-zinc-300 text-left text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
            <th className="pb-2 pr-4 font-medium">Person</th>
            <th className="pb-2 pr-4 font-medium">Venture</th>
            <th className="pb-2 pr-4 text-right font-medium">Logged</th>
            <th className="pb-2 text-right font-medium">Approved</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={`${r.personId}-${r.ventureId}`}
              className="border-b border-zinc-200 dark:border-zinc-800"
            >
              <td className="py-2.5 pr-4 text-zinc-900 dark:text-zinc-100">{r.personName}</td>
              <td className="py-2.5 pr-4 text-zinc-600 dark:text-zinc-400">{r.ventureName}</td>
              <td className="py-2.5 pr-4 text-right tabular-nums">{formatMinutes(r.minutes)}</td>
              <td className="py-2.5 text-right tabular-nums font-medium">
                {formatMinutes(r.approvedMinutes)}
              </td>
            </tr>
          ))}
          <tr className="font-medium">
            <td className="py-2.5 pr-4" colSpan={2}>
              Total
            </td>
            <td className="py-2.5 pr-4 text-right tabular-nums">{formatMinutes(total)}</td>
            <td className="py-2.5 text-right tabular-nums">{formatMinutes(totalApproved)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

async function VentureTable({ actor, filters }: Props) {
  const rows = await venturePerformance(actor, filters);
  if (rows.length === 0) return <EmptyState title="No ventures to report on" />;

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-sm">
        <thead>
          <tr className="border-b border-zinc-300 text-left text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
            <th className="pb-2 pr-4 font-medium">Venture</th>
            <th className="pb-2 pr-4 text-right font-medium">Done</th>
            <th className="pb-2 pr-4 text-right font-medium">Open</th>
            <th className="pb-2 pr-4 text-right font-medium">Estimated</th>
            <th className="pb-2 pr-4 text-right font-medium">Actual</th>
            <th className="pb-2 pr-4 text-right font-medium">Efficiency</th>
            <th className="pb-2 text-right font-medium">Overdue</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.ventureId} className="border-b border-zinc-200 dark:border-zinc-800">
              <td className="py-2.5 pr-4">
                <span className="inline-flex items-center gap-2">
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: r.tagColor }}
                    aria-hidden
                  />
                  {r.ventureName}
                </span>
              </td>
              <td className="py-2.5 pr-4 text-right tabular-nums">{r.tasksCompleted}</td>
              <td className="py-2.5 pr-4 text-right tabular-nums">{r.tasksOpen}</td>
              <td className="py-2.5 pr-4 text-right tabular-nums">
                {formatMinutes(r.estimatedMinutes)}
              </td>
              <td className="py-2.5 pr-4 text-right tabular-nums">
                {formatMinutes(r.actualMinutes)}
              </td>
              <td className="py-2.5 pr-4 text-right tabular-nums font-medium">
                {formatEfficiency(r.efficiency)}
              </td>
              <td className="py-2.5 text-right tabular-nums">
                {r.tasksOverdue > 0 ? (
                  <Badge tone="red">{r.tasksOverdue}</Badge>
                ) : (
                  <span className="text-zinc-400">0</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

async function PeopleTable({ actor, filters }: Props) {
  const rows = await personPerformance(actor, filters);
  if (rows.length === 0) return <EmptyState title="No people to report on" />;

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[780px] text-sm">
        <thead>
          <tr className="border-b border-zinc-300 text-left text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
            <th className="pb-2 pr-4 font-medium">Person</th>
            <th className="pb-2 pr-4 font-medium">Type</th>
            <th className="pb-2 pr-4 text-right font-medium">Done</th>
            <th className="pb-2 pr-4 text-right font-medium">Estimated</th>
            <th className="pb-2 pr-4 text-right font-medium">Actual</th>
            <th className="pb-2 pr-4 text-right font-medium">Efficiency</th>
            <th className="pb-2 text-right font-medium">Attendance</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.personId} className="border-b border-zinc-200 dark:border-zinc-800">
              <td className="py-2.5 pr-4 text-zinc-900 dark:text-zinc-100">{r.personName}</td>
              <td className="py-2.5 pr-4 capitalize text-zinc-600 dark:text-zinc-400">
                {r.employmentType.toLowerCase()}
              </td>
              <td className="py-2.5 pr-4 text-right tabular-nums">{r.tasksCompleted}</td>
              <td className="py-2.5 pr-4 text-right tabular-nums">
                {formatMinutes(r.estimatedMinutes)}
              </td>
              <td className="py-2.5 pr-4 text-right tabular-nums">
                {formatMinutes(r.actualMinutes)}
              </td>
              <td className="py-2.5 pr-4 text-right tabular-nums font-medium">
                {formatEfficiency(r.efficiency)}
              </td>
              <td className="py-2.5 text-right tabular-nums">
                {r.workingDaysInPeriod !== null ? (
                  <span title="Days worked out of working days in this period">
                    {r.daysWorked} / {r.workingDaysInPeriod}
                    <span className="ml-1 text-xs text-zinc-400 dark:text-zinc-600">
                      days
                    </span>
                  </span>
                ) : (
                  <span title="Days worked in this period">
                    {r.daysWorked}
                    <span className="ml-1 text-xs text-zinc-400 dark:text-zinc-600">
                      days
                    </span>
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

async function TaskTable({ actor, filters }: Props) {
  const rows = await taskEfficiencyReport(actor, filters);
  if (rows.length === 0) return <EmptyState title="No tasks to report on" />;

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-sm">
        <thead>
          <tr className="border-b border-zinc-300 text-left text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
            <th className="pb-2 pr-4 font-medium">Task</th>
            <th className="pb-2 pr-4 font-medium">Venture</th>
            <th className="pb-2 pr-4 font-medium">Status</th>
            <th className="pb-2 pr-4 text-right font-medium">Estimated</th>
            <th className="pb-2 pr-4 text-right font-medium">Actual</th>
            <th className="pb-2 pr-4 text-right font-medium">Variance</th>
            <th className="pb-2 text-right font-medium">Efficiency</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.taskId} className="border-b border-zinc-200 dark:border-zinc-800">
              <td className="py-2.5 pr-4 text-zinc-900 dark:text-zinc-100">{r.title}</td>
              <td className="py-2.5 pr-4 text-zinc-600 dark:text-zinc-400">{r.ventureName}</td>
              <td className="py-2.5 pr-4 text-xs uppercase text-zinc-500 dark:text-zinc-400">
                {r.status.replace("_", " ").toLowerCase()}
              </td>
              <td className="py-2.5 pr-4 text-right tabular-nums">
                {formatMinutes(r.estimatedMinutes)}
              </td>
              <td className="py-2.5 pr-4 text-right tabular-nums">
                {formatMinutes(r.actualMinutes)}
              </td>
              <td
                className={`py-2.5 pr-4 text-right tabular-nums ${
                  r.varianceMinutes > 0
                    ? "text-red-600 dark:text-red-400"
                    : r.varianceMinutes < 0
                      ? "text-green-600 dark:text-green-400"
                      : ""
                }`}
              >
                {r.varianceMinutes > 0 ? "+" : ""}
                {formatMinutes(Math.abs(r.varianceMinutes))}
              </td>
              <td className="py-2.5 text-right tabular-nums font-medium">
                {formatEfficiency(r.efficiency)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Attendance report (§33).
 *
 * Reuses personPerformance, which already counts submitted days by status, so
 * the report and the person page can never disagree.
 */
async function AttendanceTable({ actor, filters }: Props) {
  const rows = await personPerformance(actor, filters);
  if (rows.length === 0) return <EmptyState title="No attendance recorded for these filters" />;

  const totals = rows.reduce(
    (acc, r) => ({
      present: acc.present + r.daysPresent,
      remote: acc.remote + r.daysRemote,
      leave: acc.leave + r.daysLeave,
      absent: acc.absent + r.daysAbsent,
    }),
    { present: 0, remote: 0, leave: 0, absent: 0 },
  );

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[700px] text-sm">
        <thead>
          <tr className="border-b border-zinc-300 text-left text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
            <th className="pb-2 pr-4 font-medium">Person</th>
            <th className="pb-2 pr-4 text-right font-medium">Present</th>
            <th className="pb-2 pr-4 text-right font-medium">Remote</th>
            <th className="pb-2 pr-4 text-right font-medium">Leave</th>
            <th className="pb-2 pr-4 text-right font-medium">Absent</th>
            <th className="pb-2 text-right font-medium">Attendance</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.personId} className="border-b border-zinc-200 dark:border-zinc-800">
              <td className="py-2.5 pr-4 text-zinc-900 dark:text-zinc-100">{r.personName}</td>
              <td className="py-2.5 pr-4 text-right tabular-nums">{r.daysPresent}</td>
              <td className="py-2.5 pr-4 text-right tabular-nums">{r.daysRemote}</td>
              <td className="py-2.5 pr-4 text-right tabular-nums">{r.daysLeave}</td>
              <td className="py-2.5 pr-4 text-right tabular-nums">{r.daysAbsent}</td>
              <td className="py-2.5 text-right font-medium tabular-nums">
                {r.workingDaysInPeriod !== null ? (
                  <span title="Days worked out of working days in this period">
                    {r.daysWorked} / {r.workingDaysInPeriod}
                    <span className="ml-1 text-xs text-zinc-400 dark:text-zinc-600">
                      days
                    </span>
                  </span>
                ) : (
                  <span title="Days worked in this period">
                    {r.daysWorked}
                    <span className="ml-1 text-xs text-zinc-400 dark:text-zinc-600">
                      days
                    </span>
                  </span>
                )}
              </td>
            </tr>
          ))}
          <tr className="font-medium">
            <td className="py-2.5 pr-4">Total days</td>
            <td className="py-2.5 pr-4 text-right tabular-nums">{totals.present}</td>
            <td className="py-2.5 pr-4 text-right tabular-nums">{totals.remote}</td>
            <td className="py-2.5 pr-4 text-right tabular-nums">{totals.leave}</td>
            <td className="py-2.5 pr-4 text-right tabular-nums">{totals.absent}</td>
            <td className="py-2.5" />
          </tr>
        </tbody>
      </table>

      <p className="mt-4 text-xs text-zinc-500 dark:text-zinc-400">
        Counts only days that were submitted. People who never submitted a day appear on the
        dashboard as missing logs rather than as absent.
      </p>
    </div>
  );
}
