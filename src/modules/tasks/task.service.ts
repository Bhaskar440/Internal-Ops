import { prisma, type PrismaTransactionClient } from "@/lib/db/client";
import { writeAudit } from "@/lib/audit/audit";
import { conflict, forbidden, notFound } from "@/lib/errors/appError";
import { ventureIdScope } from "@/lib/permissions/scopes";
import { isSuperAdmin, type Actor, type ActorWithVenture } from "@/lib/permissions/types";
import { hoursToMinutes, calculateEfficiency } from "@/lib/money/efficiency";
import { notifyMany } from "@/modules/notifications/notification.service";
import { toPrismaDate } from "@/lib/timezone/businessDate";
import {
  isBackwardTransition,
  type ChangeStatusInput,
  type CreateTaskInput,
  type UpdateTaskInput,
} from "./task.schema";

/**
 * Task business logic (§15-§18).
 *
 * There is deliberately NO actual_hours column. Actual time is always the sum
 * of that task's time entries (§23) — computed here on read, never stored.
 */

const taskSelect = {
  id: true,
  ventureId: true,
  title: true,
  description: true,
  status: true,
  priority: true,
  estimatedMinutes: true,
  dueDate: true,
  boardOrder: true,
  fixedFee: true,
  feeCurrency: true,
  startedAt: true,
  completedAt: true,
  archivedAt: true,
  createdAt: true,
  venture: { select: { id: true, name: true, slug: true, tagColor: true } },
  assignees: {
    select: {
      personId: true,
      person: { select: { id: true, user: { select: { name: true } } } },
    },
  },
} as const;

export type TaskView = {
  id: string;
  ventureId: string;
  ventureName: string;
  ventureTagColor: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  estimatedMinutes: number;
  actualMinutes: number;
  efficiency: number | null;
  dueDate: Date | null;
  overdue: boolean;
  boardOrder: number;
  fixedFee: string | null;
  feeCurrency: string | null;
  completedAt: Date | null;
  archived: boolean;
  assignees: { personId: string; name: string }[];
};

/**
 * Aggregate actual minutes per task from time entries (§23).
 * Returns a map so a task list needs a single extra query, not one per row.
 */
async function actualMinutesByTask(taskIds: string[]): Promise<Map<string, number>> {
  if (taskIds.length === 0) return new Map();

  const rows = await prisma.timeEntry.groupBy({
    by: ["taskId"],
    where: { taskId: { in: taskIds }, durationSeconds: { not: null } },
    _sum: { durationSeconds: true },
  });

  return new Map(
    rows
      .filter((r) => r.taskId !== null)
      .map((r) => [r.taskId as string, Math.round((r._sum.durationSeconds ?? 0) / 60)]),
  );
}

type TaskRow = {
  id: string;
  ventureId: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  estimatedMinutes: number;
  dueDate: Date | null;
  boardOrder: number;
  fixedFee: unknown;
  feeCurrency: string | null;
  completedAt: Date | null;
  archivedAt: Date | null;
  venture: { id: string; name: string; slug: string; tagColor: string };
  assignees: { personId: string; person: { id: string; user: { name: string } } }[];
};

function toView(t: TaskRow, actualMinutes: number): TaskView {
  const isOpen = t.status !== "DONE";
  return {
    id: t.id,
    ventureId: t.ventureId,
    ventureName: t.venture.name,
    ventureTagColor: t.venture.tagColor,
    title: t.title,
    description: t.description,
    status: t.status,
    priority: t.priority,
    estimatedMinutes: t.estimatedMinutes,
    actualMinutes,
    efficiency: calculateEfficiency(t.estimatedMinutes, actualMinutes),
    dueDate: t.dueDate,
    overdue: Boolean(t.dueDate && isOpen && t.dueDate < startOfToday()),
    boardOrder: t.boardOrder,
    // Decimal never survives JSON/RSC boundaries intact — always stringify.
    fixedFee: t.fixedFee === null || t.fixedFee === undefined ? null : String(t.fixedFee),
    feeCurrency: t.feeCurrency,
    completedAt: t.completedAt,
    archived: t.archivedAt !== null,
    assignees: t.assignees.map((a) => ({ personId: a.personId, name: a.person.user.name })),
  };
}

function startOfToday(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/** Tasks the actor may see, scoped to their ventures unless Super Admin. */
export async function listTasks(
  actor: Actor,
  opts: {
    ventureId?: string;
    status?: string;
    assigneePersonId?: string;
    search?: string;
    includeArchived?: boolean;
    /** Show ONLY archived tasks — the archive view, rather than the board. */
    archivedOnly?: boolean;
    mineOnly?: boolean;
    limit?: number;
  } = {},
): Promise<TaskView[]> {
  const scope = ventureIdScope(actor);

  // An explicit ventureId must intersect the actor scope, never widen it.
  let ventureFilter = scope.ventureId;
  if (opts.ventureId) {
    if (!ventureFilter) ventureFilter = { in: [opts.ventureId] };
    else if (ventureFilter.in.includes(opts.ventureId)) ventureFilter = { in: [opts.ventureId] };
    else return [];
  }

  const assigneePersonId = opts.mineOnly ? actor.personId : opts.assigneePersonId;

  const tasks = await prisma.task.findMany({
    where: {
      ...(ventureFilter ? { ventureId: ventureFilter } : {}),
      ...(opts.archivedOnly
        ? { archivedAt: { not: null } }
        : opts.includeArchived
          ? {}
          : { archivedAt: null }),
      ...(opts.status ? { status: opts.status as never } : {}),
      ...(assigneePersonId ? { assignees: { some: { personId: assigneePersonId } } } : {}),
      ...(opts.search ? { title: { contains: opts.search, mode: "insensitive" as const } } : {}),
    },
    select: taskSelect,
    orderBy: [{ boardOrder: "asc" }, { createdAt: "desc" }],
    take: opts.limit ?? BOARD_TASK_LIMIT,
  });

  const actuals = await actualMinutesByTask(tasks.map((t) => t.id));
  return tasks.map((t) => toView(t as TaskRow, actuals.get(t.id) ?? 0));
}

/**
 * How many tasks the board loads at once.
 *
 * A Kanban board is not paginated — dragging between pages makes no sense —
 * so instead the caller is told when the view is truncated, and the filters
 * are the way to narrow it. countTasks() supplies that number.
 */
export const BOARD_TASK_LIMIT = 300;

/** Total matching tasks, so the board can say when it is showing a subset. */
export async function countTasks(
  actor: Actor,
  opts: {
    ventureId?: string;
    status?: string;
    assigneePersonId?: string;
    search?: string;
    includeArchived?: boolean;
    archivedOnly?: boolean;
    mineOnly?: boolean;
  } = {},
): Promise<number> {
  const scope = ventureIdScope(actor);

  let ventureFilter = scope.ventureId;
  if (opts.ventureId) {
    if (!ventureFilter) ventureFilter = { in: [opts.ventureId] };
    else if (ventureFilter.in.includes(opts.ventureId)) ventureFilter = { in: [opts.ventureId] };
    else return 0;
  }

  const assigneePersonId = opts.mineOnly ? actor.personId : opts.assigneePersonId;

  return prisma.task.count({
    where: {
      ...(ventureFilter ? { ventureId: ventureFilter } : {}),
      ...(opts.archivedOnly
        ? { archivedAt: { not: null } }
        : opts.includeArchived
          ? {}
          : { archivedAt: null }),
      ...(opts.status ? { status: opts.status as never } : {}),
      ...(assigneePersonId ? { assignees: { some: { personId: assigneePersonId } } } : {}),
      ...(opts.search ? { title: { contains: opts.search, mode: "insensitive" as const } } : {}),
    },
  });
}

export async function getTask(actor: Actor, taskId: string): Promise<TaskView> {
  const task = await prisma.task.findUnique({ where: { id: taskId }, select: taskSelect });
  if (!task) throw notFound("Task");

  if (!isSuperAdmin(actor) && !actor.memberships.has(task.ventureId)) {
    throw notFound("Task");
  }

  const actuals = await actualMinutesByTask([task.id]);
  return toView(task as TaskRow, actuals.get(task.id) ?? 0);
}

/** Create a task. Caller must already hold `task:create` in this venture. */
export async function createTask(
  actor: ActorWithVenture,
  input: Omit<CreateTaskInput, "description" | "dueDate"> & {
    description?: string;
    dueDate?: string;
  },
) {
  if (input.ventureId !== actor.venture.id) {
    throw forbidden("You cannot create a task in a different venture.");
  }

  // Only people who actually belong to this venture may be assigned.
  const validAssignees = await prisma.ventureMembership.findMany({
    where: {
      ventureId: input.ventureId,
      personId: { in: input.assigneeIds },
      leftAt: null,
    },
    select: { personId: true },
  });
  const assigneeIds = validAssignees.map((m) => m.personId);

  return prisma.$transaction(async (tx) => {
    const task = await tx.task.create({
      data: {
        ventureId: input.ventureId,
        title: input.title,
        description: input.description,
        estimatedMinutes: hoursToMinutes(input.estimatedHours),
        priority: input.priority,
        dueDate: input.dueDate ? toPrismaDate(input.dueDate) : undefined,
        fixedFee: input.fixedFee ?? undefined,
        feeCurrency: input.fixedFee ? (input.feeCurrency ?? actor.venture.defaultCurrency) : undefined,
        createdBy: actor.userId,
        assignees: {
          create: assigneeIds.map((personId) => ({ personId, assignedBy: actor.userId })),
        },
      },
      select: taskSelect,
    });

    await tx.taskStatusHistory.create({
      data: { taskId: task.id, fromStatus: null, toStatus: "BACKLOG", changedBy: actor.userId },
    });

    // Tell the assignees, in the same transaction as the task itself (§59).
    await notifyMany(
      assigneeIds,
      (personId) => ({
        personId,
        kind: "TASK_ASSIGNED" as const,
        title: `New task: ${task.title}`,
        body: `${actor.venture.name} · estimated ${Math.round(task.estimatedMinutes / 60)}h`,
        link: `/tasks/${task.id}`,
        dedupeKey: `task:${task.id}:assigned`,
      }),
      tx,
    );

    await writeAudit(tx, {
      actorUserId: actor.userId,
      action: "TASK_CREATED",
      entityType: "Task",
      entityId: task.id,
      after: {
        title: task.title,
        ventureId: task.ventureId,
        estimatedMinutes: task.estimatedMinutes,
        assignees: assigneeIds,
      },
    });

    return toView(task as TaskRow, 0);
  });
}

/** Update a task, including reassignment. */
export async function updateTask(actor: ActorWithVenture, input: UpdateTaskInput) {
  const before = await prisma.task.findUnique({
    where: { id: input.taskId },
    select: taskSelect,
  });
  if (!before) throw notFound("Task");
  if (before.ventureId !== actor.venture.id) throw notFound("Task");

  return prisma.$transaction(async (tx) => {
    if (input.assigneeIds) {
      const valid = await tx.ventureMembership.findMany({
        where: {
          ventureId: before.ventureId,
          personId: { in: input.assigneeIds },
          leftAt: null,
        },
        select: { personId: true },
      });
      const wanted = new Set(valid.map((m) => m.personId));
      const current = new Set(before.assignees.map((a) => a.personId));

      const toRemove = [...current].filter((id) => !wanted.has(id));
      const toAdd = [...wanted].filter((id) => !current.has(id));

      if (toRemove.length) {
        await tx.taskAssignee.deleteMany({
          where: { taskId: input.taskId, personId: { in: toRemove } },
        });
      }
      for (const personId of toAdd) {
        await tx.taskAssignee.create({
          data: { taskId: input.taskId, personId, assignedBy: actor.userId },
        });
      }
    }

    const after = await tx.task.update({
      where: { id: input.taskId },
      data: {
        title: input.title,
        description: input.description,
        estimatedMinutes:
          input.estimatedHours === undefined ? undefined : hoursToMinutes(input.estimatedHours),
        priority: input.priority,
        dueDate: input.dueDate ? toPrismaDate(input.dueDate) : undefined,
        fixedFee: input.fixedFee === undefined ? undefined : input.fixedFee,
        feeCurrency: input.feeCurrency === undefined ? undefined : input.feeCurrency,
      },
      select: taskSelect,
    });

    await writeAudit(tx, {
      actorUserId: actor.userId,
      action: "TASK_UPDATED",
      entityType: "Task",
      entityId: input.taskId,
      before: { title: before.title, estimatedMinutes: before.estimatedMinutes },
      after: { title: after.title, estimatedMinutes: after.estimatedMinutes },
    });

    const actuals = await actualMinutesByTask([after.id]);
    return toView(after as TaskRow, actuals.get(after.id) ?? 0);
  });
}

/**
 * Change task status (§18).
 *
 * Backwards moves are allowed only for admin/manager, and are refused
 * server-side even if the client permitted the drag. Every transition is
 * recorded with old status, new status, who and when.
 */
export async function changeTaskStatus(actor: ActorWithVenture, input: ChangeStatusInput) {
  const before = await prisma.task.findUnique({
    where: { id: input.taskId },
    select: { ...taskSelect, status: true },
  });
  if (!before) throw notFound("Task");
  if (before.ventureId !== actor.venture.id) throw notFound("Task");
  if (before.status === input.status) return toView(before as TaskRow, 0);

  const backwards = isBackwardTransition(before.status, input.status);
  const isManager = isSuperAdmin(actor) || actor.ventureRole === "MANAGER";
  if (backwards && !isManager) {
    throw forbidden("Only a manager can move a task backwards.");
  }

  // Completing a task is treated as final: its hours have fed efficiency
  // reporting and may already sit in an approved day. Reopening one is
  // possible but reserved for a Super Admin, and is always audited, so a
  // genuine mistake can still be corrected without letting the board drift.
  const reopening = before.status === "DONE" && input.status !== "DONE";
  if (reopening && !isSuperAdmin(actor)) {
    throw forbidden(
      "A completed task cannot be reopened. Ask an administrator if this was marked done by mistake.",
    );
  }

  return prisma.$transaction(async (tx) => {
    const after = await tx.task.update({
      where: { id: input.taskId },
      data: {
        status: input.status,
        startedAt:
          input.status === "IN_PROGRESS" && !before.startedAt ? new Date() : undefined,
        completedAt:
          input.status === "DONE" ? new Date() : before.status === "DONE" ? null : undefined,
      },
      select: taskSelect,
    });

    await tx.taskStatusHistory.create({
      data: {
        taskId: input.taskId,
        fromStatus: before.status as never,
        toStatus: input.status,
        changedBy: actor.userId,
      },
    });

    await writeAudit(tx, {
      actorUserId: actor.userId,
      action: "TASK_STATUS_CHANGED",
      entityType: "Task",
      entityId: input.taskId,
      before: { status: before.status },
      after: { status: input.status },
      reason: reopening
        ? "Completed task reopened by an administrator"
        : backwards
          ? "Moved backwards by manager"
          : undefined,
    });

    if (input.status === "DONE") {
      await archiveOldestCompleted(tx, actor, before.ventureId);
    }

    const actuals = await actualMinutesByTask([after.id]);
    return toView(after as TaskRow, actuals.get(after.id) ?? 0);
  });
}

/**
 * Keep at most DONE_ON_BOARD completed tasks on the live board.
 *
 * A venture that finishes work steadily otherwise grows an unreadable Done
 * column. Once a sixth task completes, the oldest is archived — it keeps every
 * detail and its hours still count, it simply moves to the archive view where
 * it can be restored or deleted.
 *
 * Runs in the caller's transaction so the board and the archive can never
 * disagree, and each archive is audited with a reason making clear it was
 * automatic rather than someone's decision.
 */
const DONE_ON_BOARD = 5;

async function archiveOldestCompleted(
  tx: PrismaTransactionClient,
  actor: ActorWithVenture,
  ventureId: string,
) {
  const done = await tx.task.findMany({
    where: { ventureId, status: "DONE", archivedAt: null },
    // Oldest completion first; completedAt is set whenever a task reaches DONE.
    orderBy: [{ completedAt: "asc" }, { updatedAt: "asc" }],
    select: { id: true, title: true, completedAt: true },
  });

  const excess = done.length - DONE_ON_BOARD;
  if (excess <= 0) return;

  for (const task of done.slice(0, excess)) {
    await tx.task.update({
      where: { id: task.id },
      data: { archivedAt: new Date() },
    });
    await writeAudit(tx, {
      actorUserId: actor.userId,
      action: "TASK_ARCHIVED",
      entityType: "Task",
      entityId: task.id,
      before: { title: task.title, status: "DONE" },
      reason: `Archived automatically: more than ${DONE_ON_BOARD} completed tasks on the board`,
    });
  }
}

/** Archive a task (soft delete, §47). Time entries survive and still count. */
export async function archiveTask(actor: ActorWithVenture, taskId: string, reason?: string) {
  const before = await prisma.task.findUnique({ where: { id: taskId }, select: taskSelect });
  if (!before) throw notFound("Task");
  if (before.ventureId !== actor.venture.id) throw notFound("Task");
  if (before.archivedAt) throw conflict("This task is already archived.");

  return prisma.$transaction(async (tx) => {
    await tx.task.update({ where: { id: taskId }, data: { archivedAt: new Date() } });
    await writeAudit(tx, {
      actorUserId: actor.userId,
      action: "TASK_ARCHIVED",
      entityType: "Task",
      entityId: taskId,
      before: { title: before.title, status: before.status },
      reason,
    });
  });
}

/** Status history for a task detail page (§18). */
export async function getTaskHistory(actor: Actor, taskId: string) {
  await getTask(actor, taskId); // authorization check
  return prisma.taskStatusHistory.findMany({
    where: { taskId },
    orderBy: { changedAt: "desc" },
    select: { id: true, fromStatus: true, toStatus: true, changedAt: true, changedBy: true },
  });
}

/**
 * Permanently delete an archived task.
 *
 * Unlike archiving this is irreversible, so it is deliberately narrow:
 *
 *   - the task must already be archived, making deletion a second, separate
 *     decision rather than a single click from the board;
 *   - a task with logged time cannot be deleted at all. Those hours belong to
 *     approved days and possibly to a payroll run, and deleting the task would
 *     leave that history pointing at nothing. The database enforces this too
 *     (TimeEntry.task is onDelete: Restrict); the check here exists to explain
 *     why rather than surface a constraint violation.
 *
 * Assignees and status history are removed with it by cascade.
 */
export async function deleteTask(actor: ActorWithVenture, taskId: string) {
  if (!isSuperAdmin(actor) && actor.ventureRole !== "MANAGER") {
    throw forbidden("Only a manager can delete a task.");
  }

  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { id: true, ventureId: true, title: true, status: true, archivedAt: true },
  });
  if (!task) throw notFound("Task");
  if (task.ventureId !== actor.venture.id) throw notFound("Task");
  if (!task.archivedAt) {
    throw conflict("Archive this task before deleting it.");
  }

  const loggedEntries = await prisma.timeEntry.count({ where: { taskId } });
  if (loggedEntries > 0) {
    throw conflict(
      `This task has ${loggedEntries} time ${
        loggedEntries === 1 ? "entry" : "entries"
      } recorded against it and cannot be deleted. It stays in the archive so those hours keep their history.`,
    );
  }

  return prisma.$transaction(async (tx) => {
    // Audit BEFORE the delete: afterwards there is no row left to describe.
    await writeAudit(tx, {
      actorUserId: actor.userId,
      action: "TASK_DELETED",
      entityType: "Task",
      entityId: taskId,
      before: { title: task.title, status: task.status },
      reason: "Permanently deleted from the archive",
    });
    await tx.task.delete({ where: { id: taskId } });
  });
}

/**
 * Bring an archived task back to the live board (§47).
 *
 * Necessary counterpart to automatic archiving: work that was tidied away by a
 * counter rather than by a decision has to be recoverable.
 */
export async function restoreTask(actor: ActorWithVenture, taskId: string) {
  if (!isSuperAdmin(actor) && actor.ventureRole !== "MANAGER") {
    throw forbidden("Only a manager can restore a task.");
  }

  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { id: true, ventureId: true, title: true, status: true, archivedAt: true },
  });
  if (!task) throw notFound("Task");
  if (task.ventureId !== actor.venture.id) throw notFound("Task");
  if (!task.archivedAt) throw conflict("This task is not archived.");

  return prisma.$transaction(async (tx) => {
    await tx.task.update({ where: { id: taskId }, data: { archivedAt: null } });
    await writeAudit(tx, {
      actorUserId: actor.userId,
      action: "TASK_UPDATED",
      entityType: "Task",
      entityId: taskId,
      before: { archived: true },
      after: { archived: false },
      reason: "Restored from the archive",
    });
  });
}
