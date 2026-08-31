import { checkGlobal } from "@/lib/permissions/guard";
import { AccessDenied } from "@/components/layout/AccessDenied";
import { workDiary } from "@/modules/dailyLogs/dailyLog.service";
import { listPeople } from "@/modules/people/person.service";
import { listVentures } from "@/modules/ventures/venture.service";
import { Card, PageHeader, Badge, EmptyState } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { DATE_MIN, DATE_MAX } from "@/components/ui/Field";
import { formatMinutes } from "@/lib/money/efficiency";
import { currentBusinessDate } from "@/lib/timezone/businessDate";

export const dynamic = "force-dynamic";
export const metadata = { title: "Work diary" };

const STATUS_TONE: Record<string, "neutral" | "green" | "amber" | "red" | "blue"> = {
  DRAFT: "neutral",
  SUBMITTED: "blue",
  APPROVED: "green",
  REJECTED: "red",
  LOCKED: "neutral",
};

/**
 * What everyone actually did, day by day (§33).
 *
 * Administrators only. An employee sees their own days and a manager sees the
 * ones they approve; this is the only place that reads across people and weeks
 * at once, which is a different question from approving a single day.
 *
 * The service enforces that too — the guard here only avoids rendering a page
 * that would throw.
 */
export default async function WorkDiaryPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; person?: string; venture?: string }>;
}) {
  const access = await checkGlobal("payroll:read");
  if (!access.allowed) return <AccessDenied area="the work diary" />;
  const actor = access.actor;

  const params = await searchParams;

  // Default to the last 30 days, which is the span this is usually opened for.
  const today = currentBusinessDate("Asia/Kolkata");
  const defaultFrom = new Date(`${today}T12:00:00Z`);
  defaultFrom.setUTCDate(defaultFrom.getUTCDate() - 30);

  const from = params.from ?? defaultFrom.toISOString().slice(0, 10);
  const to = params.to ?? today;

  const [days, people, ventures] = await Promise.all([
    workDiary(actor, {
      from,
      to,
      personId: params.person || undefined,
      ventureId: params.venture || undefined,
    }),
    listPeople(actor),
    listVentures(actor),
  ]);

  const totalMinutes = days.reduce((sum, d) => sum + d.totalMinutes, 0);

  return (
    <>
      <PageHeader
        title="Work diary"
        description={
          days.length > 0
            ? `${days.length} days · ${formatMinutes(Math.round(totalMinutes))} recorded`
            : "What each person recorded doing, day by day."
        }
      />

      <form className="mb-6 flex flex-wrap items-end gap-3 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
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
            defaultValue={from}
            min={DATE_MIN}
            max={DATE_MAX}
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
            defaultValue={to}
            min={DATE_MIN}
            max={DATE_MAX}
            className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
        </div>

        <div>
          <label
            htmlFor="person"
            className="mb-1.5 block text-xs font-medium text-zinc-600 dark:text-zinc-400"
          >
            Person
          </label>
          <select
            id="person"
            name="person"
            defaultValue={params.person ?? ""}
            className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          >
            <option value="">Everyone</option>
            {people.map((p) => (
              <option key={p.personId} value={p.personId}>
                {p.name}
              </option>
            ))}
          </select>
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

        <Button type="submit">Apply</Button>
      </form>

      {days.length === 0 ? (
        <EmptyState
          title="Nothing recorded in this period"
          description="Days appear here once people have logged what they worked on."
        />
      ) : (
        <div className="space-y-3">
          {days.map((day) => (
            <Card key={day.logId}>
              <div className="p-4">
                <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="font-medium text-zinc-900 dark:text-zinc-100">
                      {day.personName}
                    </span>
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">
                      {day.personEmail}
                    </span>
                    <span className="inline-flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-400">
                      <span
                        className="h-1.5 w-1.5 rounded-full"
                        style={{ backgroundColor: day.ventureTagColor }}
                        aria-hidden
                      />
                      {day.ventureName}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
                      {day.businessDate}
                    </span>
                    <Badge tone={day.attendanceStatus === "PRESENT" ? "green" : "neutral"}>
                      {day.attendanceStatus.toLowerCase().replace("_", " ")}
                    </Badge>
                    <Badge tone={STATUS_TONE[day.status] ?? "neutral"}>
                      {day.status.toLowerCase()}
                    </Badge>
                    <span className="text-sm tabular-nums font-medium text-zinc-900 dark:text-zinc-100">
                      {formatMinutes(Math.round(day.totalMinutes))}
                    </span>
                  </div>
                </div>

                {day.entries.length === 0 ? (
                  <p className="text-sm text-zinc-500 dark:text-zinc-400">
                    Attendance recorded, no hours logged.
                  </p>
                ) : (
                  <ul className="space-y-1.5">
                    {day.entries.map((entry, i) => (
                      <li
                        key={i}
                        className="flex flex-wrap items-baseline gap-x-3 border-t border-zinc-100 pt-1.5 text-sm dark:border-zinc-800"
                      >
                        <span className="tabular-nums text-zinc-500 dark:text-zinc-400">
                          {formatMinutes(entry.minutes)}
                        </span>
                        <span className="font-medium text-zinc-700 dark:text-zinc-300">
                          {entry.taskTitle ?? "General work"}
                        </span>
                        <span className="flex-1 text-zinc-600 dark:text-zinc-400">
                          {entry.description ?? "—"}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
