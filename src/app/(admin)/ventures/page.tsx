import Link from "next/link";
import { checkGlobal } from "@/lib/permissions/guard";
import { AccessDenied } from "@/components/layout/AccessDenied";
import { listVentures } from "@/modules/ventures/venture.service";
import { Card, PageHeader, EmptyState, Badge } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { WEEKDAYS } from "@/modules/ventures/venture.schema";

export const dynamic = "force-dynamic";
export const metadata = { title: "Ventures" };

export default async function VenturesPage() {
  // Super Admin only — enforced server-side, not by hiding the nav link.
  const access = await checkGlobal("venture:list:all");
  if (!access.allowed) return <AccessDenied area="venture management" />;
  const actor = access.actor;
  const ventures = await listVentures(actor, { includeArchived: true });

  const active = ventures.filter((v) => v.active);
  const archived = ventures.filter((v) => !v.active);

  return (
    <>
      <PageHeader
        title="Ventures"
        description="Each venture has its own timezone, working week and daily-log cutoff."
        action={
          <Link href="/ventures/new">
            <Button>Create venture</Button>
          </Link>
        }
      />

      {active.length === 0 ? (
        <EmptyState
          title="No ventures yet"
          description="Create a venture to start assigning people and tracking work."
          action={
            <Link href="/ventures/new">
              <Button>Create venture</Button>
            </Link>
          }
        />
      ) : (
        <div className="space-y-3">
          {active.map((v) => (
            <Card key={v.id}>
              <div className="flex flex-wrap items-center gap-4 p-4">
                <span
                  className="h-3 w-3 shrink-0 rounded-full"
                  style={{ backgroundColor: v.tagColor }}
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <h3 className="font-medium text-zinc-900 dark:text-zinc-100">{v.name}</h3>
                  <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                    /{v.slug} · {v.timezone} · {v.defaultCurrency} ·{" "}
                    {v.workingDays.map((d) => WEEKDAYS.find((w) => w.value === d)?.label).join(" ")} ·{" "}
                    {v.dailyLogEditWindowHours}h edit window
                  </p>
                </div>
                <Badge tone="blue">
                  {v.memberCount} {v.memberCount === 1 ? "person" : "people"}
                </Badge>
                <Link href={`/ventures/${v.slug}`}>
                  <Button variant="secondary">Settings</Button>
                </Link>
              </div>
            </Card>
          ))}
        </div>
      )}

      {archived.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Archived
          </h2>
          <div className="space-y-2">
            {archived.map((v) => (
              <Card key={v.id} className="opacity-70">
                <div className="flex items-center gap-4 p-3">
                  <span className="min-w-0 flex-1 text-sm text-zinc-600 dark:text-zinc-400">
                    {v.name} <span className="text-xs">/{v.slug}</span>
                  </span>
                  <Badge>Archived</Badge>
                </div>
              </Card>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
