import Link from "next/link";
import { requireActiveActor } from "@/lib/auth/actor";
import { listTasks, countTasks, BOARD_TASK_LIMIT } from "@/modules/tasks/task.service";
import { listVentures } from "@/modules/ventures/venture.service";
import { isSuperAdmin } from "@/lib/permissions/types";
import { PageHeader, EmptyState, Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { KanbanBoard, type BoardTask } from "@/components/kanban/KanbanBoard";
import { fromPrismaDate } from "@/lib/timezone/businessDate";

export const dynamic = "force-dynamic";
export const metadata = { title: "Tasks" };

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<{ venture?: string; mine?: string; q?: string }>;
}) {
  const params = await searchParams;
  const actor = await requireActiveActor();

  const filters = {
    ventureId: params.venture,
    search: params.q,
    mineOnly: params.mine === "1",
  };

  const [tasks, totalMatching, ventures] = await Promise.all([
    listTasks(actor, filters),
    countTasks(actor, filters),
    listVentures(actor),
  ]);

  // A board cannot paginate sensibly, so say plainly when it is showing a
  // subset rather than quietly dropping the rest.
  const truncated = totalMatching > tasks.length;

  // Managers and admins may move cards; members may not drag tasks backwards,
  // which the server enforces regardless of what the UI allows.
  const canManage =
    isSuperAdmin(actor) || [...actor.memberships.values()].includes("MANAGER");

  const board: BoardTask[] = tasks.map((t) => ({
    id: t.id,
    ventureId: t.ventureId,
    ventureName: t.ventureName,
    ventureTagColor: t.ventureTagColor,
    title: t.title,
    status: t.status,
    priority: t.priority,
    estimatedMinutes: t.estimatedMinutes,
    actualMinutes: t.actualMinutes,
    efficiency: t.efficiency,
    dueDate: t.dueDate ? fromPrismaDate(t.dueDate) : null,
    overdue: t.overdue,
    assignees: t.assignees,
  }));

  return (
    <>
      <PageHeader
        title="Tasks"
        description="Drag a card to change its status. Every move is recorded."
        action={
          canManage ? (
            <Link href="/tasks/new">
              <Button>Create task</Button>
            </Link>
          ) : undefined
        }
      />

      <Card className="mb-4">
        <form className="flex flex-wrap items-end gap-3 p-4">
          <div className="min-w-48 flex-1">
            <label
              htmlFor="q"
              className="mb-1.5 block text-xs font-medium text-zinc-600 dark:text-zinc-400"
            >
              Search
            </label>
            <input
              id="q"
              name="q"
              defaultValue={params.q}
              placeholder="Task title"
              className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            />
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
          <label className="flex cursor-pointer items-center gap-2 rounded-md border border-zinc-300 px-3 py-2 text-sm has-[:checked]:border-blue-500 has-[:checked]:bg-blue-50 dark:border-zinc-700 dark:has-[:checked]:bg-blue-950/40">
            <input
              type="checkbox"
              name="mine"
              value="1"
              defaultChecked={params.mine === "1"}
              className="h-3.5 w-3.5 accent-blue-600"
            />
            Only mine
          </label>
          <Button variant="secondary" type="submit">
            Apply
          </Button>
          {(params.q || params.venture || params.mine) && (
            <Link
              href="/tasks"
              className="px-2 py-2 text-sm text-zinc-600 hover:underline dark:text-zinc-400"
            >
              Clear
            </Link>
          )}
        </form>
      </Card>

      {board.length === 0 ? (
        <EmptyState
          title="No tasks found"
          description={
            params.q || params.venture || params.mine
              ? "Try clearing the filters."
              : "Create a task with an estimate to start tracking work against it."
          }
          action={
            canManage ? (
              <Link href="/tasks/new">
                <Button>Create task</Button>
              </Link>
            ) : undefined
          }
        />
      ) : (
        <>
          {truncated && (
            <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
              Showing the first {BOARD_TASK_LIMIT} of {totalMatching} tasks. Filter by
              venture or search to narrow the board.
            </div>
          )}
          <KanbanBoard tasks={board} canMove={canManage} />
        </>
      )}
    </>
  );
}
