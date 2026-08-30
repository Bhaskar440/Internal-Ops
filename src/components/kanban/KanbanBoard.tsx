"use client";

import { useOptimistic, useState, useSyncExternalStore, useTransition } from "react";
import Link from "next/link";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  useDraggable,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { changeStatusAction } from "@/app/(admin)/tasks/actions";
import { TASK_STATUSES } from "@/modules/tasks/task.schema";
import { formatMinutes, formatEfficiency } from "@/lib/money/efficiency";

export type BoardTask = {
  id: string;
  ventureId: string;
  ventureName: string;
  ventureTagColor: string;
  title: string;
  status: string;
  priority: string;
  estimatedMinutes: number;
  actualMinutes: number;
  efficiency: number | null;
  dueDate: string | null;
  overdue: boolean;
  assignees: { personId: string; name: string }[];
};

const PRIORITY_STYLE: Record<string, string> = {
  URGENT: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  HIGH: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  MEDIUM: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  LOW: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
};

function Card({ task, dragging }: { task: BoardTask; dragging?: boolean }) {
  return (
    <div
      className={`rounded-lg border bg-white p-3 shadow-sm dark:bg-zinc-900 ${
        dragging
          ? "border-blue-400 opacity-90 shadow-md"
          : "border-zinc-200 dark:border-zinc-800"
      }`}
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <span className="text-sm font-medium leading-snug text-zinc-900 dark:text-zinc-100">
          {task.title}
        </span>
        <span
          className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
            PRIORITY_STYLE[task.priority] ?? PRIORITY_STYLE.MEDIUM
          }`}
        >
          {task.priority}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400">
        <span className="inline-flex items-center gap-1">
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{ backgroundColor: task.ventureTagColor }}
            aria-hidden
          />
          {task.ventureName}
        </span>
        <span>
          est {formatMinutes(task.estimatedMinutes)}
          {task.actualMinutes > 0 && ` · act ${formatMinutes(task.actualMinutes)}`}
        </span>
        {task.efficiency !== null && (
          <span
            className={
              task.efficiency >= 100
                ? "text-green-600 dark:text-green-400"
                : task.efficiency >= 80
                  ? "text-amber-600 dark:text-amber-400"
                  : "text-red-600 dark:text-red-400"
            }
          >
            {formatEfficiency(task.efficiency)}
          </span>
        )}
        {task.dueDate && (
          <span className={task.overdue ? "font-medium text-red-600 dark:text-red-400" : ""}>
            due {task.dueDate}
            {task.overdue && " · overdue"}
          </span>
        )}
      </div>

      {task.assignees.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {task.assignees.map((a) => (
            <span
              key={a.personId}
              className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
            >
              {a.name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function DraggableCard({
  task,
  canMove,
  mounted,
}: {
  task: BoardTask;
  canMove: boolean;
  /** Drag attributes are attached only after mount — see KanbanBoard. */
  mounted: boolean;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: task.id,
    disabled: !canMove,
  });

  // dnd-kit numbers its aria-describedby ids per DndContext instance, so the
  // value rendered on the server never matches the one the browser generates.
  // Attaching the attributes only after mount keeps the first client render
  // identical to the server's, which is what hydration compares.
  const dragProps = canMove && mounted ? { ...listeners, ...attributes } : {};

  return (
    <div
      ref={setNodeRef}
      {...dragProps}
      className={`${canMove ? "cursor-grab active:cursor-grabbing" : ""} ${
        isDragging ? "opacity-40" : ""
      }`}
    >
      <Link href={`/tasks/${task.id}`} className="block" onClick={(e) => isDragging && e.preventDefault()}>
        <Card task={task} />
      </Link>
    </div>
  );
}

function Column({
  status,
  label,
  tasks,
  canMove,
  mounted,
}: {
  status: string;
  label: string;
  tasks: BoardTask[];
  canMove: boolean;
  mounted: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  const totalEstimate = tasks.reduce((s, t) => s + t.estimatedMinutes, 0);

  return (
    <div
      ref={setNodeRef}
      className={`flex min-h-64 flex-col rounded-xl border p-3 transition-colors ${
        isOver
          ? "border-blue-400 bg-blue-50/60 dark:bg-blue-950/20"
          : "border-zinc-200 bg-zinc-50/60 dark:border-zinc-800 dark:bg-zinc-900/40"
      }`}
    >
      <div className="mb-3 flex items-baseline justify-between">
        <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">{label}</h3>
        <span className="text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
          {tasks.length}
          {totalEstimate > 0 && ` · ${formatMinutes(totalEstimate)}`}
        </span>
      </div>

      <div className="flex flex-1 flex-col gap-2">
        {tasks.length === 0 ? (
          <p className="py-6 text-center text-xs text-zinc-400 dark:text-zinc-600">
            Nothing here
          </p>
        ) : (
          tasks.map((t) => (
            <DraggableCard key={t.id} task={t} canMove={canMove} mounted={mounted} />
          ))
        )}
      </div>
    </div>
  );
}

/**
 * Kanban board (§15, §18).
 *
 * The move is applied optimistically for responsiveness, but the SERVER is
 * authoritative: if it refuses — for example a member trying to drag a task
 * backwards — the card snaps back and the reason is shown.
 */
/** A store that never emits: `mounted` only needs the server/client split. */
function subscribeToNothing() {
  return () => {};
}

export function KanbanBoard({
  tasks,
  canMove,
}: {
  tasks: BoardTask[];
  canMove: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  // False while rendering on the server and during hydration, true afterwards.
  // Cards become draggable only once the browser has taken over, so the first
  // client render matches exactly what the server sent.
  const mounted = useSyncExternalStore(
    subscribeToNothing,
    () => true,
    () => false,
  );

  const [optimistic, applyOptimistic] = useOptimistic(
    tasks,
    (state: BoardTask[], move: { id: string; status: string }) =>
      state.map((t) => (t.id === move.id ? { ...t, status: move.status } : t)),
  );

  const sensors = useSensors(
    // A small distance threshold keeps card clicks working alongside dragging.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  function onDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
  }

  function onDragEnd(event: DragEndEvent) {
    setActiveId(null);
    const taskId = String(event.active.id);
    const newStatus = event.over ? String(event.over.id) : null;
    if (!newStatus) return;

    const task = optimistic.find((t) => t.id === taskId);
    if (!task || task.status === newStatus) return;

    setError(null);
    startTransition(async () => {
      applyOptimistic({ id: taskId, status: newStatus });
      const result = await changeStatusAction(taskId, task.ventureId, newStatus);
      if (!result.ok) {
        // The optimistic state is discarded when the transition ends, so the
        // card returns to its real column on its own.
        setError(result.error ?? "That move was not allowed.");
      }
    });
  }

  const active = activeId ? optimistic.find((t) => t.id === activeId) : null;

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

      <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {TASK_STATUSES.map((s) => (
            <Column
              key={s.value}
              status={s.value}
              label={s.label}
              tasks={optimistic.filter((t) => t.status === s.value)}
              canMove={canMove}
              mounted={mounted}
            />
          ))}
        </div>

        <DragOverlay>{active ? <Card task={active} dragging /> : null}</DragOverlay>
      </DndContext>
    </>
  );
}
