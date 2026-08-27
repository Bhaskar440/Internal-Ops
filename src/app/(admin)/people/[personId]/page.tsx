import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActiveActor } from "@/lib/auth/actor";
import { getPerson } from "@/modules/people/person.service";
import { listVentures } from "@/modules/ventures/venture.service";
import { isSuperAdmin } from "@/lib/permissions/types";
import { isAppError } from "@/lib/errors/appError";
import { Card, PageHeader, Badge, EmptyState } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { setMembershipAction, removeMembershipAction } from "../actions";
import { ACCESS_ROLES } from "@/modules/people/person.schema";

export const dynamic = "force-dynamic";

const STATUS_TONE = {
  ACTIVE: "green",
  PENDING: "amber",
  SUSPENDED: "red",
  INACTIVE: "neutral",
} as const;

export default async function PersonDetailPage({
  params,
}: {
  params: Promise<{ personId: string }>;
}) {
  const { personId } = await params;
  const actor = await requireActiveActor();

  let person;
  try {
    person = await getPerson(actor, personId);
  } catch (e) {
    if (isAppError(e) && e.code === "NOT_FOUND") notFound();
    throw e;
  }

  const admin = isSuperAdmin(actor);
  const allVentures = await listVentures(actor);

  // Ventures the actor may assign into and where this person is not yet a member.
  const assignedIds = new Set(person.ventures.map((v) => v.id));
  const assignable = allVentures.filter((v) => {
    if (assignedIds.has(v.id)) return false;
    return admin || actor.memberships.get(v.id) === "MANAGER";
  });

  return (
    <>
      <PageHeader
        title={person.name}
        description={person.email}
        action={
          <Link href="/people" className="text-sm text-zinc-600 hover:underline dark:text-zinc-400">
            Back to people
          </Link>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <div className="p-6">
            <h2 className="mb-4 font-medium text-zinc-900 dark:text-zinc-100">Profile</h2>
            <dl className="space-y-3 text-sm">
              <Row label="Status">
                <Badge tone={STATUS_TONE[person.accountStatus as keyof typeof STATUS_TONE] ?? "neutral"}>
                  {person.accountStatus.toLowerCase()}
                </Badge>
              </Row>
              <Row label="Employment">
                <span className="capitalize">{person.employmentType.toLowerCase()}</span>
              </Row>
              <Row label="Phone">{person.phone ?? "—"}</Row>
              <Row label="Start date">
                {person.startDate ? person.startDate.toISOString().slice(0, 10) : "—"}
              </Row>
              {person.globalRole === "SUPER_ADMIN" && (
                <Row label="Global role">
                  <Badge tone="blue">Super Admin</Badge>
                </Row>
              )}
            </dl>

            <p className="mt-6 border-t border-zinc-200 pt-4 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
              Compensation is managed separately and is visible only to authorized
              administrators.
            </p>
          </div>
        </Card>

        <Card className="lg:col-span-2">
          <div className="p-6">
            <h2 className="mb-1 font-medium text-zinc-900 dark:text-zinc-100">Ventures</h2>
            <p className="mb-4 text-sm text-zinc-600 dark:text-zinc-400">
              Employment type and access role are independent — a freelancer can manage a
              venture.
            </p>

            {person.ventures.length === 0 ? (
              <EmptyState title="Not assigned to any venture yet" />
            ) : (
              <ul className="space-y-2">
                {person.ventures.map((v) => {
                  const canEdit = admin || actor.memberships.get(v.id) === "MANAGER";
                  return (
                    <li
                      key={v.id}
                      className="flex flex-wrap items-center gap-3 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800"
                    >
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: v.tagColor }}
                        aria-hidden
                      />
                      <span className="flex-1 text-sm font-medium text-zinc-900 dark:text-zinc-100">
                        {v.name}
                      </span>

                      {canEdit ? (
                        <form action={setMembershipAction} className="flex items-center gap-2">
                          <input type="hidden" name="personId" value={person.personId} />
                          <input type="hidden" name="ventureId" value={v.id} />
                          <select
                            name="accessRole"
                            defaultValue={v.accessRole}
                            className="rounded-md border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900"
                          >
                            {ACCESS_ROLES.map((r) => (
                              <option key={r.value} value={r.value}>
                                {r.label}
                              </option>
                            ))}
                          </select>
                          <Button variant="secondary" type="submit" className="px-2 py-1 text-xs">
                            Save
                          </Button>
                        </form>
                      ) : (
                        <Badge tone={v.accessRole === "MANAGER" ? "blue" : "neutral"}>
                          {v.accessRole === "MANAGER" ? "Manager" : "Member"}
                        </Badge>
                      )}

                      {canEdit && (
                        <form action={removeMembershipAction}>
                          <input type="hidden" name="personId" value={person.personId} />
                          <input type="hidden" name="ventureId" value={v.id} />
                          <Button
                            variant="ghost"
                            type="submit"
                            className="px-2 py-1 text-xs text-red-600 dark:text-red-400"
                          >
                            Remove
                          </Button>
                        </form>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}

            {assignable.length > 0 && (
              <form
                action={setMembershipAction}
                className="mt-4 flex flex-wrap items-end gap-2 border-t border-zinc-200 pt-4 dark:border-zinc-800"
              >
                <input type="hidden" name="personId" value={person.personId} />
                <div className="flex-1">
                  <label
                    htmlFor="addVenture"
                    className="mb-1.5 block text-xs font-medium text-zinc-600 dark:text-zinc-400"
                  >
                    Add to venture
                  </label>
                  <select
                    id="addVenture"
                    name="ventureId"
                    className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                  >
                    {assignable.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label
                    htmlFor="addRole"
                    className="mb-1.5 block text-xs font-medium text-zinc-600 dark:text-zinc-400"
                  >
                    Role
                  </label>
                  <select
                    id="addRole"
                    name="accessRole"
                    defaultValue="MEMBER"
                    className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                  >
                    {ACCESS_ROLES.map((r) => (
                      <option key={r.value} value={r.value}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                </div>
                <Button type="submit">Add</Button>
              </form>
            )}
          </div>
        </Card>
      </div>
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-zinc-500 dark:text-zinc-400">{label}</dt>
      <dd className="text-zinc-900 dark:text-zinc-100">{children}</dd>
    </div>
  );
}
