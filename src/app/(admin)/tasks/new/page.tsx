import { requireActiveActor } from "@/lib/auth/actor";
import { prisma } from "@/lib/db/client";
import { listVentures } from "@/modules/ventures/venture.service";
import { isSuperAdmin } from "@/lib/permissions/types";
import { TaskForm, type VentureOption } from "@/components/forms/TaskForm";
import { createTaskAction } from "../actions";
import { Card, PageHeader, EmptyState } from "@/components/ui/Card";

export const dynamic = "force-dynamic";
export const metadata = { title: "Create task" };

export default async function NewTaskPage() {
  const actor = await requireActiveActor();

  // Only ventures where this actor may actually create tasks.
  const all = await listVentures(actor);
  const allowed = all.filter(
    (v) => isSuperAdmin(actor) || actor.memberships.get(v.id) === "MANAGER",
  );

  if (allowed.length === 0) {
    return (
      <>
        <PageHeader title="Create task" />
        <EmptyState
          title="No ventures available"
          description="You need to manage at least one venture before you can create tasks in it."
        />
      </>
    );
  }

  const memberships = await prisma.ventureMembership.findMany({
    where: { ventureId: { in: allowed.map((v) => v.id) }, leftAt: null },
    select: {
      ventureId: true,
      personId: true,
      person: { select: { user: { select: { name: true } } } },
    },
    orderBy: { person: { user: { name: "asc" } } },
  });

  const ventures: VentureOption[] = allowed.map((v) => ({
    id: v.id,
    name: v.name,
    tagColor: v.tagColor,
    defaultCurrency: v.defaultCurrency,
    members: memberships
      .filter((m) => m.ventureId === v.id)
      .map((m) => ({ personId: m.personId, name: m.person.user.name })),
  }));

  return (
    <>
      <PageHeader
        title="Create task"
        description="An estimate is required — it is what efficiency is measured against."
      />
      <Card className="max-w-3xl">
        <div className="p-6">
          <TaskForm action={createTaskAction} ventures={ventures} submitLabel="Create task" />
        </div>
      </Card>
    </>
  );
}
