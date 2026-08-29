import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActiveActor } from "@/lib/auth/actor";
import { getTask, getTaskHistory } from "@/modules/tasks/task.service";
import { prisma } from "@/lib/db/client";
import { isSuperAdmin } from "@/lib/permissions/types";
import { isAppError } from "@/lib/errors/appError";
import { fromPrismaDate } from "@/lib/timezone/businessDate";
import { formatMinutes, formatEfficiency } from "@/lib/money/efficiency";
import { Card, PageHeader, Badge, EmptyState } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { TaskDetailActions } from "./TaskDetailActions";
import { archiveTaskAction } from "../actions";

export const dynamic = "force-dynamic";

const PRIORITY_TONE: Record<string, "neutral" | "green" | "amber" | "red" | "blue"> = {
  URGENT: "red",
  HIGH: "amber",
  MEDIUM: "neutral",
  LOW: "neutral",
};

const STATUS_TONE: Record<string, "neutral" | "green" | "amber" | "red" | "blue"> = {
  BACKLOG: "neutral",
  IN_PROGRESS: "blue",
  REVIEW: "amber",
  DONE: "green",
};

export default async function TaskDetailPage({
  params,
}: {
  params: Promise<{ taskId: string }>;
}) {
  const { taskId } = await params;
  const actor = await requireActiveActor();

  let task;
  try {
    task = await getTask(actor, taskId);
  } catch (e) {
    // Out-of-scope tasks report not-found, so their existence cannot be probed.
    if (isAppError(e) && e.code === "NOT_FOUND") notFound();
    throw e;
  }

  const canManage = isSuperAdmin(actor) || actor.memberships.get(task.ventureId) === "MANAGER";

  const [history, entries] = await Promise.all([
    getTaskHistory(actor, taskId),
    // Who logged time against this task, and when.
    prisma.timeEntry.findMany({
      where: { taskId, durationSeconds: { not: null } },
      orderBy: { businessDate: "desc" },
      take: 50,
      select: {
        id: true,
        durationSeconds: true,
        businessDate: true,
        note: true,
        source: true,
        approvalStatus: true,
        person: { select: { user: { select: { name: true } } } },
      },
    }),
  ]);

  // Resolve actor names for the history without exposing anything else.
  const actorIds = [...new Set(history.map((h) => h.changedBy))];
  const users = await prisma.user.findMany({
    where: { id: { in: actorIds } },
    select: { id: true, name: true },
  });
  const nameById = new Map(users.map((u) => [u.id, u.name]));

  const variance = task.actualMinutes - task.estimatedMinutes;

  return (
    <>
      <PageHeader
        title={task.title}
        description={`${task.ventureName}${task.archived ? " · archived" : ""}`}
        action={
          <Link href="/tasks" className="text-sm text-zinc-600 hover:underline dark:text-zinc-400">
            Back to board
          </Link>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {/* Status and description */}
          <Card>
            <div className="p-6">
              <div className="mb-4 flex flex-wrap items-center gap-2">
                <Badge tone={STATUS_TONE[task.status] ?? "neutral"}>
                  {task.status.replace("_", " ").toLowerCase()}
                </Badge>
                <Badge tone={PRIORITY_TONE[task.priority] ?? "neutral"}>
                  {task.priority.toLowerCase()} priority
                </Badge>
                {task.overdue && <Badge tone="red">overdue</Badge>}
                {task.fixedFee && (
                  <Badge tone="blue">
                    fixed fee {task.feeCurrency} {Number(task.fixedFee).toLocaleString()}
                  </Badge>
                )}
              </div>

              {task.description ? (
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
                  {task.description}
                </p>
              ) : (
                <p className="text-sm italic text-zinc-400 dark:text-zinc-600">
                  No description.
                </p>
              )}

              {canManage && !task.archived && (
                <div className="mt-5 border-t border-zinc-200 pt-4 dark:border-zinc-800">
                  <TaskDetailActions
                    taskId={task.id}
                    ventureId={task.ventureId}
                    status={task.status}
                  />
                </div>
              )}
            </div>
          </Card>

          {/* Time logged against this task */}
          <Card>
            <div className="p-6">
              <h2 className="mb-4 font-medium text-zinc-900 dark:text-zinc-100">
                Time logged
              </h2>

              {entries.length === 0 ? (
                <EmptyState
                  title="No time recorded yet"
                  description="Hours appear here as people run timers or add entries against this task."
                />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[480px] text-sm">
                    <thead>
                      <tr className="border-b border-zinc-300 text-left text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
                        <th className="pb-2 pr-4 font-medium">Person</th>
                        <th className="pb-2 pr-4 font-medium">Date</th>
                        <th className="pb-2 pr-4 font-medium">Note</th>
                        <th className="pb-2 text-right font-medium">Hours</th>
                      </tr>
                    </thead>
                    <tbody>
                      {entries.map((e) => (
                        <tr key={e.id} className="border-b border-zinc-200 dark:border-zinc-800">
                          <td className="py-2.5 pr-4 text-zinc-900 dark:text-zinc-100">
                            {e.person.user.name}
                          </td>
                          <td className="py-2.5 pr-4 tabular-nums text-zinc-600 dark:text-zinc-400">
                            {fromPrismaDate(e.businessDate)}
                          </td>
                          <td className="py-2.5 pr-4 text-zinc-500 dark:text-zinc-400">
                            {e.note ?? "—"}
                            {e.approvalStatus === "NEEDS_REVIEW" && (
                              <Badge tone="amber">needs review</Badge>
                            )}
                          </td>
                          <td className="py-2.5 text-right tabular-nums">
                            {formatMinutes(Math.round((e.durationSeconds ?? 0) / 60))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </Card>

          {/* Status history (§18) */}
          <Card>
            <div className="p-6">
              <h2 className="mb-4 font-medium text-zinc-900 dark:text-zinc-100">
                Status history
              </h2>
              <ol className="space-y-3">
                {history.map((h) => (
                  <li key={h.id} className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="text-zinc-500 dark:text-zinc-400">
                      {h.fromStatus
                        ? `${h.fromStatus.replace("_", " ").toLowerCase()} → `
                        : "created as "}
                    </span>
                    <span className="font-medium text-zinc-900 dark:text-zinc-100">
                      {h.toStatus.replace("_", " ").toLowerCase()}
                    </span>
                    <span className="text-zinc-500 dark:text-zinc-400">
                      by {nameById.get(h.changedBy) ?? "unknown"}
                    </span>
                    <span className="ml-auto text-xs tabular-nums text-zinc-400 dark:text-zinc-600">
                      {h.changedAt.toISOString().replace("T", " ").slice(0, 16)} UTC
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          </Card>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          <Card>
            <div className="p-6">
              <h2 className="mb-4 font-medium text-zinc-900 dark:text-zinc-100">
                Estimate vs actual
              </h2>

              <dl className="space-y-3 text-sm">
                <Row label="Estimated">{formatMinutes(task.estimatedMinutes)}</Row>
                <Row label="Actual">{formatMinutes(task.actualMinutes)}</Row>
                <Row label="Variance">
                  <span
                    className={
                      variance > 0
                        ? "text-red-600 dark:text-red-400"
                        : variance < 0
                          ? "text-green-600 dark:text-green-400"
                          : ""
                    }
                  >
                    {variance > 0 ? "+" : variance < 0 ? "−" : ""}
                    {formatMinutes(Math.abs(variance))}
                  </span>
                </Row>
                <Row label="Efficiency">
                  <span className="font-medium">{formatEfficiency(task.efficiency)}</span>
                </Row>
              </dl>

              {task.efficiency === null && (
                <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
                  Efficiency needs logged hours before it can be calculated.
                </p>
              )}
            </div>
          </Card>

          <Card>
            <div className="p-6">
              <h2 className="mb-4 font-medium text-zinc-900 dark:text-zinc-100">Details</h2>
              <dl className="space-y-3 text-sm">
                <Row label="Venture">{task.ventureName}</Row>
                <Row label="Due">
                  {task.dueDate ? fromPrismaDate(task.dueDate) : "—"}
                </Row>
                <Row label="Completed">
                  {task.completedAt ? task.completedAt.toISOString().slice(0, 10) : "—"}
                </Row>
              </dl>

              <div className="mt-4 border-t border-zinc-200 pt-4 dark:border-zinc-800">
                <div className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                  Assignees
                </div>
                {task.assignees.length === 0 ? (
                  <p className="text-sm text-zinc-400 dark:text-zinc-600">Nobody assigned.</p>
                ) : (
                  <ul className="space-y-1">
                    {task.assignees.map((a) => (
                      <li key={a.personId} className="text-sm">
                        <Link
                          href={`/people/${a.personId}`}
                          className="text-zinc-900 hover:underline dark:text-zinc-100"
                        >
                          {a.name}
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </Card>

          {canManage && !task.archived && (
            <Card className="border-red-200 dark:border-red-900">
              <div className="p-6">
                <h2 className="font-medium text-zinc-900 dark:text-zinc-100">Archive task</h2>
                <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                  Hides it from the board. Logged time is kept and still counts towards
                  reporting.
                </p>
                <form action={archiveTaskAction} className="mt-3 space-y-2">
                  <input type="hidden" name="taskId" value={task.id} />
                  <input type="hidden" name="ventureId" value={task.ventureId} />
                  <input
                    name="reason"
                    aria-label="Reason for archiving this task"
                    placeholder="Reason (recorded in the audit log)"
                    className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                  />
                  <Button variant="danger" type="submit">
                    Archive
                  </Button>
                </form>
              </div>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-zinc-500 dark:text-zinc-400">{label}</dt>
      <dd className="tabular-nums text-zinc-900 dark:text-zinc-100">{children}</dd>
    </div>
  );
}
