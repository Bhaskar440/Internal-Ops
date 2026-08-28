import { requireActiveActor } from "@/lib/auth/actor";
import { getMyDay } from "@/modules/dailyLogs/dailyLog.service";
import { getActiveTimer } from "@/modules/time/time.service";
import { listTasks } from "@/modules/tasks/task.service";
import { PageHeader, EmptyState } from "@/components/ui/Card";
import { DayVentureSection, type DaySection } from "@/components/forms/DayVentureSection";
import { formatMinutes } from "@/lib/money/efficiency";

export const dynamic = "force-dynamic";
export const metadata = { title: "My day" };

export default async function MyDayPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const params = await searchParams;
  const actor = await requireActiveActor();

  const [logs, activeTimer, tasks] = await Promise.all([
    getMyDay(actor, params.date),
    actor.personId ? getActiveTimer(actor.personId) : Promise.resolve(null),
    listTasks(actor, { mineOnly: true }),
  ]);

  const sections: DaySection[] = logs.map((log) => ({
    logId: log.id,
    ventureId: log.ventureId,
    ventureName: log.ventureName,
    ventureTagColor: log.ventureTagColor,
    businessDate: log.businessDate,
    attendanceStatus: log.attendanceStatus,
    status: log.status,
    generalNote: log.generalNote,
    totalMinutes: log.totalMinutes,
    editable: log.editable,
    attendanceConflict: log.attendanceConflict,
    entries: log.entries.map((e) => ({
      id: e.id,
      taskId: e.taskId,
      taskTitle: e.taskTitle,
      source: e.source,
      durationMinutes: e.durationMinutes,
      note: e.note,
      running: e.running,
      approvalStatus: e.approvalStatus,
    })),
    tasks: tasks
      .filter((t) => t.ventureId === log.ventureId && t.status !== "DONE")
      .map((t) => ({ id: t.id, title: t.title })),
  }));

  const dayTotal = sections.reduce((sum, s) => sum + s.totalMinutes, 0);

  return (
    <>
      <PageHeader
        title="My day"
        description={
          sections.length > 0
            ? `${sections[0].businessDate} · ${formatMinutes(dayTotal)} logged`
            : "Record what you worked on today."
        }
      />

      {activeTimer && (
        <div className="mb-5 rounded-lg border border-blue-300 bg-blue-50 px-4 py-3 text-sm dark:border-blue-900 dark:bg-blue-950/30">
          <span className="font-medium text-blue-900 dark:text-blue-200">Timer running</span>
          <span className="ml-2 text-blue-800 dark:text-blue-300">
            {activeTimer.taskTitle ?? "General work"} · {activeTimer.ventureName} · started{" "}
            {activeTimer.startedAt.toISOString().slice(11, 16)} UTC
          </span>
        </div>
      )}

      {sections.length === 0 ? (
        <EmptyState
          title="You are not assigned to a venture yet"
          description="An administrator needs to add you to a venture before you can log time."
        />
      ) : (
        <div className="space-y-5">
          {sections.map((s) => (
            <DayVentureSection
              key={s.logId}
              section={s}
              hasRunningTimer={activeTimer?.ventureId === s.ventureId}
            />
          ))}
        </div>
      )}
    </>
  );
}
