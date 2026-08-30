import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActiveActor } from "@/lib/auth/actor";
import { getPerson } from "@/modules/people/person.service";
import { listVentures } from "@/modules/ventures/venture.service";
import { listAgreements } from "@/modules/compensation/compensation.service";
import { assetsHeldBy, listDocuments } from "@/modules/hr/hr.service";
import { personPerformance } from "@/modules/reports/report.service";
import { listTasks } from "@/modules/tasks/task.service";
import { prisma } from "@/lib/db/client";
import { isSuperAdmin } from "@/lib/permissions/types";
import { isAppError } from "@/lib/errors/appError";
import { formatMinutes, formatEfficiency } from "@/lib/money/efficiency";
import { fromPrismaDate } from "@/lib/timezone/businessDate";
import { Card, PageHeader, Badge, EmptyState } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Tabs } from "@/components/layout/Tabs";
import { setMembershipAction, removeMembershipAction } from "../actions";
import { CompensationPanel } from "@/components/forms/CompensationPanel";
import { GlobalRolePanel } from "@/components/forms/GlobalRolePanel";
import { ACCESS_ROLES } from "@/modules/people/person.schema";

export const dynamic = "force-dynamic";

const STATUS_TONE = {
  ACTIVE: "green",
  PENDING: "amber",
  SUSPENDED: "red",
  INACTIVE: "neutral",
} as const;

const DOC_TONE: Record<string, "neutral" | "green" | "amber" | "red" | "blue"> = {
  VERIFIED: "green",
  SUBMITTED: "blue",
  PENDING: "amber",
  REJECTED: "red",
  EXPIRED: "red",
};

/**
 * Person detail (§12).
 *
 * Tabs mirror the spec: Profile, Work, Hardware, Documents, Compensation.
 * The HR and compensation tabs are fetched ONLY for a Super Admin — a manager's
 * request never loads that data, so it cannot reach the browser at all (§52).
 */
export default async function PersonDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ personId: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { personId } = await params;
  const { tab: rawTab } = await searchParams;
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

  // Drives whether the demote control is offered: the service refuses to remove
  // the last active Super Admin, so the UI should not pretend otherwise.
  const otherActiveSuperAdmins = admin
    ? await prisma.user.count({
        where: {
          globalRole: "SUPER_ADMIN",
          accountStatus: "ACTIVE",
          id: { not: person.userId },
        },
      })
    : 0;

  // HR and pay data are loaded only when the caller is allowed to see them.
  const [agreements, assets, documents] = admin
    ? await Promise.all([
        listAgreements(actor, person.personId),
        assetsHeldBy(actor, person.personId),
        listDocuments(actor, { personId: person.personId }),
      ])
    : [[], [], []];

  const tabs = [
    { key: "profile", label: "Profile" },
    { key: "work", label: "Work" },
    ...(admin
      ? [
          { key: "hardware", label: "Hardware", count: assets.length },
          { key: "documents", label: "Documents", count: documents.length },
          { key: "compensation", label: "Compensation" },
        ]
      : []),
  ];

  const tab = tabs.find((t) => t.key === rawTab)?.key ?? "profile";

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

      <Tabs
        tabs={tabs}
        active={tab}
        hrefFor={(k) => `/people/${person.personId}?tab=${k}`}
      />

      {tab === "profile" && (
        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-1">
            <div className="p-6">
              <h2 className="mb-4 font-medium text-zinc-900 dark:text-zinc-100">Details</h2>
              <dl className="space-y-3 text-sm">
                <Row label="Status">
                  <Badge
                    tone={STATUS_TONE[person.accountStatus as keyof typeof STATUS_TONE] ?? "neutral"}
                  >
                    {person.accountStatus.toLowerCase()}
                  </Badge>
                </Row>
                <Row label="Employment">
                  <span className="capitalize">{person.employmentType.toLowerCase()}</span>
                </Row>
                <Row label="Phone">{person.phone ?? "—"}</Row>
                <Row label="Start date">
                  {person.startDate ? fromPrismaDate(person.startDate) : "—"}
                </Row>
                {person.endDate && (
                  <Row label="End date">{fromPrismaDate(person.endDate)}</Row>
                )}
                {person.globalRole === "SUPER_ADMIN" && (
                  <Row label="Global role">
                    <Badge tone="blue">Super Admin</Badge>
                  </Row>
                )}
              </dl>

              {admin && (
                <GlobalRolePanel
                  userId={person.userId}
                  personId={person.personId}
                  personName={person.name}
                  isSuper={person.globalRole === "SUPER_ADMIN"}
                  isSelf={person.userId === actor.userId}
                  canDemote={otherActiveSuperAdmins > 0}
                />
              )}

              {!admin && (
                <p className="mt-6 border-t border-zinc-200 pt-4 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                  Compensation and HR records are visible only to administrators.
                </p>
              )}
            </div>
          </Card>

          <VenturesCard
            person={person}
            allVentures={allVentures}
            actor={actor}
            admin={admin}
          />
        </div>
      )}

      {tab === "work" && <WorkTab actor={actor} personId={person.personId} />}

      {tab === "hardware" && admin && (
        <Card>
          <div className="p-6">
            <h2 className="mb-1 font-medium text-zinc-900 dark:text-zinc-100">
              Hardware currently held
            </h2>
            <p className="mb-4 text-sm text-zinc-600 dark:text-zinc-400">
              Assets move between people and keep their full history. Issue and return them
              from the <Link href="/hr" className="text-blue-600 hover:underline dark:text-blue-400">HR records</Link> page.
            </p>

            {assets.length === 0 ? (
              <EmptyState title="No hardware assigned" />
            ) : (
              <ul className="space-y-2">
                {assets.map((a) => (
                  <li
                    key={a.id}
                    className="flex flex-wrap items-center gap-3 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800"
                  >
                    <span className="flex-1 text-sm font-medium text-zinc-900 dark:text-zinc-100">
                      {a.asset.itemName}
                    </span>
                    {a.asset.assetTag && (
                      <span className="font-mono text-xs text-zinc-500 dark:text-zinc-400">
                        {a.asset.assetTag}
                      </span>
                    )}
                    <span className="text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
                      since {a.issuedAt.toISOString().slice(0, 10)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      )}

      {tab === "documents" && admin && (
        <Card>
          <div className="p-6">
            <h2 className="mb-1 font-medium text-zinc-900 dark:text-zinc-100">Documents</h2>
            <p className="mb-4 text-sm text-zinc-600 dark:text-zinc-400">
              References only — the files themselves stay in your secure storage.
            </p>

            {documents.length === 0 ? (
              <EmptyState title="No document records" />
            ) : (
              <ul className="space-y-2">
                {documents.map((d) => (
                  <li
                    key={d.id}
                    className="flex flex-wrap items-center gap-3 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800"
                  >
                    <span className="flex-1 text-sm font-medium text-zinc-900 dark:text-zinc-100">
                      {d.docType}
                    </span>
                    {d.expiryDate && (
                      <span
                        className={`text-xs tabular-nums ${
                          d.expired
                            ? "font-medium text-red-600 dark:text-red-400"
                            : d.expiringSoon
                              ? "font-medium text-amber-600 dark:text-amber-400"
                              : "text-zinc-500 dark:text-zinc-400"
                        }`}
                      >
                        {d.expired ? "expired" : "expires"} {d.expiryDate}
                      </span>
                    )}
                    {d.externalLink && (
                      <a
                        href={d.externalLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-blue-600 hover:underline dark:text-blue-400"
                      >
                        Open
                      </a>
                    )}
                    <Badge tone={DOC_TONE[d.status] ?? "neutral"}>{d.status.toLowerCase()}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      )}

      {tab === "compensation" && admin && (
        <Card>
          <div className="p-6">
            <CompensationPanel
              personId={person.personId}
              agreements={agreements}
              defaultCurrency={allVentures[0]?.defaultCurrency ?? "INR"}
            />
          </div>
        </Card>
      )}
    </>
  );
}

/** Work summary: tasks, hours, efficiency and attendance (§12). */
async function WorkTab({
  actor,
  personId,
}: {
  actor: Awaited<ReturnType<typeof requireActiveActor>>;
  personId: string;
}) {
  const [performance, tasks, hours] = await Promise.all([
    personPerformance(actor, { personId }),
    listTasks(actor, { assigneePersonId: personId }),
    prisma.timeEntry.aggregate({
      where: { personId, durationSeconds: { not: null } },
      _sum: { durationSeconds: true },
    }),
  ]);

  const stats = performance[0];
  const openTasks = tasks.filter((t) => t.status !== "DONE");
  const totalMinutes = Math.round((hours._sum.durationSeconds ?? 0) / 60);

  return (
    <>
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Open tasks" value={openTasks.length} />
        <Stat label="Completed" value={stats?.tasksCompleted ?? 0} />
        <Stat label="Hours logged" value={formatMinutes(totalMinutes)} />
        <Stat
          label="Efficiency"
          value={formatEfficiency(stats?.efficiency ?? null)}
          hint="completed tasks"
        />
      </div>

      {stats && (
        <Card className="mb-6">
          <div className="p-6">
            <h2 className="mb-4 font-medium text-zinc-900 dark:text-zinc-100">Attendance</h2>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
              <Stat label="Present" value={stats.daysPresent} plain />
              <Stat label="Remote" value={stats.daysRemote} plain />
              <Stat label="Leave" value={stats.daysLeave} plain />
              <Stat label="Absent" value={stats.daysAbsent} plain />
              <Stat
                label="Attendance"
                value={
                  stats.workingDaysInPeriod !== null
                    ? `${stats.daysWorked} / ${stats.workingDaysInPeriod} days`
                    : `${stats.daysWorked} days`
                }
                plain
              />
            </div>
          </div>
        </Card>
      )}

      <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        Assigned tasks
      </h2>

      {tasks.length === 0 ? (
        <EmptyState title="No tasks assigned" />
      ) : (
        <div className="space-y-2">
          {tasks.slice(0, 25).map((t) => (
            <Card key={t.id}>
              <Link
                href={`/tasks/${t.id}`}
                className="flex flex-wrap items-center gap-3 p-4 hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
              >
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: t.ventureTagColor }}
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    {t.title}
                  </div>
                  <div className="text-xs text-zinc-500 dark:text-zinc-400">
                    {t.ventureName} · est {formatMinutes(t.estimatedMinutes)}
                    {t.actualMinutes > 0 && ` · act ${formatMinutes(t.actualMinutes)}`}
                  </div>
                </div>
                {t.overdue && <Badge tone="red">overdue</Badge>}
                <Badge tone={t.status === "DONE" ? "green" : "neutral"}>
                  {t.status.replace("_", " ").toLowerCase()}
                </Badge>
              </Link>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}

function VenturesCard({
  person,
  allVentures,
  actor,
  admin,
}: {
  person: Awaited<ReturnType<typeof getPerson>>;
  allVentures: Awaited<ReturnType<typeof listVentures>>;
  actor: Awaited<ReturnType<typeof requireActiveActor>>;
  admin: boolean;
}) {
  const assignedIds = new Set(person.ventures.map((v) => v.id));
  const assignable = allVentures.filter((v) => {
    if (assignedIds.has(v.id)) return false;
    return admin || actor.memberships.get(v.id) === "MANAGER";
  });

  return (
    <Card className="lg:col-span-2">
      <div className="p-6">
        <h2 className="mb-1 font-medium text-zinc-900 dark:text-zinc-100">Ventures</h2>
        <p className="mb-4 text-sm text-zinc-600 dark:text-zinc-400">
          Employment type and access role are independent — a freelancer can manage a venture.
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
                        aria-label={`Access role in ${v.name}`}
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
  );
}

function Stat({
  label,
  value,
  hint,
  plain,
}: {
  label: string;
  value: number | string;
  hint?: string;
  plain?: boolean;
}) {
  const body = (
    <div className={plain ? "" : "p-4"}>
      <div className="text-2xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
        {value}
      </div>
      <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
        {label}
        {hint && <span className="ml-1 text-zinc-400 dark:text-zinc-600">· {hint}</span>}
      </div>
    </div>
  );
  return plain ? body : <Card>{body}</Card>;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-zinc-500 dark:text-zinc-400">{label}</dt>
      <dd className="text-zinc-900 dark:text-zinc-100">{children}</dd>
    </div>
  );
}
