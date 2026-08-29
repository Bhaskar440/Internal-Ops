import Link from "next/link";
import { notFound } from "next/navigation";
import { requireGlobal } from "@/lib/permissions/guard";
import { prisma } from "@/lib/db/client";
import { listPeople } from "@/modules/people/person.service";
import { VentureForm } from "@/components/forms/VentureForm";
import { updateVentureAction, archiveVentureAction } from "../actions";
import { Card, PageHeader, EmptyState, Badge } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";

export const dynamic = "force-dynamic";

export default async function VentureSettingsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const actor = await requireGlobal("settings:write");

  const venture = await prisma.venture.findUnique({
    where: { slug },
    select: {
      id: true,
      name: true,
      slug: true,
      tagColor: true,
      timezone: true,
      workingDays: true,
      dailyLogEditWindowHours: true,
      defaultCurrency: true,
      archivedAt: true,
      _count: { select: { timeEntries: true } },
    },
  });

  if (!venture) notFound();

  // Timezone becomes immutable once time exists — changing it would
  // reinterpret every stored business date.
  const timezoneLocked = venture._count.timeEntries > 0;
  const team = await listPeople(actor, { ventureId: venture.id });

  return (
    <>
      <PageHeader
        title={venture.name}
        description={`/${venture.slug}`}
        action={
          <Link
            href="/ventures"
            className="text-sm text-zinc-600 hover:underline dark:text-zinc-400"
          >
            Back to ventures
          </Link>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card>
            <div className="p-6">
              <h2 className="mb-4 font-medium text-zinc-900 dark:text-zinc-100">Settings</h2>
              <VentureForm
                action={updateVentureAction}
                submitLabel="Save changes"
                timezoneLocked={timezoneLocked}
                initial={{
                  id: venture.id,
                  name: venture.name,
                  slug: venture.slug,
                  timezone: venture.timezone,
                  tagColor: venture.tagColor,
                  workingDays: venture.workingDays,
                  dailyLogEditWindowHours: venture.dailyLogEditWindowHours,
                  defaultCurrency: venture.defaultCurrency,
                }}
              />
            </div>
          </Card>

          {!venture.archivedAt && (
            <Card className="mt-6 border-red-200 dark:border-red-900">
              <div className="p-6">
                <h2 className="font-medium text-zinc-900 dark:text-zinc-100">Archive venture</h2>
                <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                  Archiving hides the venture from active lists. Nothing is deleted — its
                  tasks, time entries and history remain available for reporting.
                </p>
                <form action={archiveVentureAction} className="mt-4 flex gap-2">
                  <input type="hidden" name="id" value={venture.id} />
                  <input
                    name="reason"
                    aria-label="Reason for archiving this venture"
                    placeholder="Reason (recorded in the audit log)"
                    className="flex-1 rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                  />
                  <Button variant="danger" type="submit">
                    Archive
                  </Button>
                </form>
              </div>
            </Card>
          )}
        </div>

        <div>
          <Card>
            <div className="p-6">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="font-medium text-zinc-900 dark:text-zinc-100">Team</h2>
                <Link
                  href="/people"
                  className="text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
                >
                  Manage
                </Link>
              </div>
              {team.length === 0 ? (
                <EmptyState title="No one assigned yet" />
              ) : (
                <ul className="space-y-3">
                  {team.map((p) => {
                    const role = p.ventures.find((v) => v.id === venture.id)?.accessRole;
                    return (
                      <li key={p.personId} className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate text-sm text-zinc-900 dark:text-zinc-100">
                            {p.name}
                          </div>
                          <div className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                            {p.employmentType.toLowerCase()}
                          </div>
                        </div>
                        <Badge tone={role === "MANAGER" ? "blue" : "neutral"}>
                          {role === "MANAGER" ? "Manager" : "Member"}
                        </Badge>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
