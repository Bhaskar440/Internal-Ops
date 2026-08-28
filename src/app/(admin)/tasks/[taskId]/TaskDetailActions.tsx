"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { changeStatusAction } from "../actions";
import { TASK_STATUSES } from "@/modules/tasks/task.schema";

/**
 * Move a task between statuses from its detail page, for people who would
 * rather not drag a card. The server decides, exactly as on the board — a
 * refused move shows its reason rather than silently doing nothing.
 */
export function TaskDetailActions({
  taskId,
  ventureId,
  status,
}: {
  taskId: string;
  ventureId: string;
  status: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function move(next: string) {
    setError(null);
    startTransition(async () => {
      const result = await changeStatusAction(taskId, ventureId, next);
      if (!result.ok) setError(result.error ?? "That move was not allowed.");
    });
  }

  return (
    <div>
      <div className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        Move to
      </div>
      <div className="flex flex-wrap gap-2">
        {TASK_STATUSES.filter((s) => s.value !== status).map((s) => (
          <Button
            key={s.value}
            variant="secondary"
            disabled={pending}
            onClick={() => move(s.value)}
          >
            {s.label}
          </Button>
        ))}
      </div>

      {error && (
        <p
          role="alert"
          className="mt-3 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
        >
          {error}
        </p>
      )}
    </div>
  );
}
