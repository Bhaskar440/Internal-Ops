"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Card";
import { formatMinutes } from "@/lib/money/efficiency";
import { restoreTaskAction, deleteTaskAction } from "@/app/(admin)/tasks/actions";

export type ArchivedTask = {
  id: string;
  ventureId: string;
  ventureName: string;
  ventureTagColor: string;
  title: string;
  status: string;
  estimatedMinutes: number;
  actualMinutes: number;
  completedAt: string | null;
};

/**
 * The archive, as a list rather than a board.
 *
 * Archived work is reviewed and acted on — restored or deleted — not dragged
 * between columns, so a Kanban view here would offer the one interaction that
 * does not apply and hide the two that do.
 */
export function ArchivedTaskList({
  tasks,
  canManage,
  error,
}: {
  tasks: ArchivedTask[];
  canManage: boolean;
  /** Message from a refused delete, passed back through the URL. */
  error?: string;
}) {
  // Which row is asking "are you sure?". Deleting is irreversible, so it never
  // happens on a single click.
  const [confirming, setConfirming] = useState<string | null>(null);

  return (
    <>
      {error && (
        <div
          role="alert"
          className="mb-4 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
        >
          {error}
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
        <table className="w-full min-w-[42rem] text-sm">
          <thead className="border-b border-zinc-200 bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-400">
            <tr>
              <th scope="col" className="px-4 py-2.5 font-medium">Task</th>
              <th scope="col" className="px-4 py-2.5 font-medium">Venture</th>
              <th scope="col" className="px-4 py-2.5 text-right font-medium">Estimated</th>
              <th scope="col" className="px-4 py-2.5 text-right font-medium">Actual</th>
              {canManage && (
                <th scope="col" className="px-4 py-2.5 text-right font-medium">Actions</th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {tasks.map((t) => (
              <tr key={t.id} className="align-middle">
                <td className="px-4 py-3">
                  <Link
                    href={`/tasks/${t.id}`}
                    className="font-medium text-zinc-900 hover:underline dark:text-zinc-100"
                  >
                    {t.title}
                  </Link>
                  <div className="mt-0.5 flex items-center gap-2">
                    <Badge tone={t.status === "DONE" ? "green" : "neutral"}>
                      {t.status.toLowerCase().replace("_", " ")}
                    </Badge>
                    {t.completedAt && (
                      <span className="text-xs text-zinc-500 dark:text-zinc-400">
                        completed {t.completedAt}
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <span className="inline-flex items-center gap-1.5 text-zinc-600 dark:text-zinc-400">
                    <span
                      className="h-1.5 w-1.5 rounded-full"
                      style={{ backgroundColor: t.ventureTagColor }}
                      aria-hidden
                    />
                    {t.ventureName}
                  </span>
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-zinc-600 dark:text-zinc-400">
                  {formatMinutes(t.estimatedMinutes)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-zinc-600 dark:text-zinc-400">
                  {t.actualMinutes > 0 ? formatMinutes(t.actualMinutes) : "—"}
                </td>

                {canManage && (
                  <td className="px-4 py-3">
                    {confirming === t.id ? (
                      <div className="flex flex-col items-end gap-2">
                        <span className="text-xs text-red-700 dark:text-red-400">
                          Delete permanently? This cannot be undone.
                        </span>
                        <div className="flex justify-end gap-2">
                          <form action={deleteTaskAction}>
                            <input type="hidden" name="taskId" value={t.id} />
                            <input type="hidden" name="ventureId" value={t.ventureId} />
                            <Button type="submit" variant="danger">
                              Yes, delete
                            </Button>
                          </form>
                          <Button
                            type="button"
                            variant="secondary"
                            onClick={() => setConfirming(null)}
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex justify-end gap-2">
                        <form action={restoreTaskAction}>
                          <input type="hidden" name="taskId" value={t.id} />
                          <input type="hidden" name="ventureId" value={t.ventureId} />
                          <Button type="submit" variant="secondary">
                            Restore
                          </Button>
                        </form>
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={() => setConfirming(t.id)}
                        >
                          Delete
                        </Button>
                      </div>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
