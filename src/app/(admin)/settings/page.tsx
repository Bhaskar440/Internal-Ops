import Link from "next/link";
import { checkGlobal } from "@/lib/permissions/guard";
import { AccessDenied } from "@/components/layout/AccessDenied";
import { listVentures } from "@/modules/ventures/venture.service";
import { isEmailConfigured } from "@/lib/email/mailer";
import { isMyPayEnabled } from "@/modules/compensation/compensation.service";
import { Card, PageHeader, Badge, EmptyState } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { VentureSettingsRow } from "@/components/forms/VentureSettingsRow";
import { prisma } from "@/lib/db/client";

export const dynamic = "force-dynamic";
export const metadata = { title: "Settings" };

/**
 * Settings (§8, §87).
 *
 * Most configuration is per-venture and lives on each venture's own page —
 * timezone, working week, daily-log cutoff, currency. This page gathers those
 * in one view and shows the system-level settings that come from environment
 * variables, so an admin can see what is switched on without reading .env.
 */
export default async function SettingsPage() {
  const access = await checkGlobal("settings:write");
  if (!access.allowed) return <AccessDenied area="settings" />;
  const actor = access.actor;

  const ventures = await listVentures(actor);

  // updateVenture refuses a timezone change once time exists, because it would
  // reinterpret every historical business date. Ask up front so the field is
  // disabled with a reason instead of failing on save.
  const withTime = await prisma.timeEntry.groupBy({
    by: ["ventureId"],
    where: { ventureId: { in: ventures.map((v) => v.id) } },
    _count: { _all: true },
  });
  const lockedTimezones = new Set(withTime.map((r) => r.ventureId));

  const systemSettings = [
    {
      label: "Email delivery",
      value: isEmailConfigured() ? "Enabled" : "Not configured",
      on: isEmailConfigured(),
      detail: isEmailConfigured()
        ? "Invitations and password resets are emailed automatically."
        : "Invitation and reset links are shown in the app for you to pass on. Set RESEND_API_KEY to switch to email.",
    },
    {
      label: "Employee pay visibility",
      value: isMyPayEnabled() ? "Employees see their pay" : "Hidden from employees",
      on: isMyPayEnabled(),
      detail: isMyPayEnabled()
        ? "Each person can see their own approved hours and computed pay. Nobody sees anyone else's."
        : "Computed pay is visible to administrators only. Set FEATURE_MY_PAY_ENABLED=true to let people see their own.",
    },
    {
      label: "Scheduled jobs",
      value: process.env.CRON_SECRET ? "Configured" : "Not configured",
      on: Boolean(process.env.CRON_SECRET),
      detail: process.env.CRON_SECRET
        ? "Abandoned timers are stopped nightly and flagged for review."
        : "Set CRON_SECRET so abandoned timers are cleaned up automatically.",
    },
    {
      label: "Timer review threshold",
      value: `${process.env.TIMER_REVIEW_THRESHOLD_HOURS ?? 12} hours`,
      on: true,
      detail: "Timers running longer than this are flagged for a manager to confirm.",
    },
    {
      label: "Timer auto-stop",
      value: `${process.env.TIMER_AUTO_STOP_HOURS ?? 24} hours`,
      on: true,
      detail:
        "Timers left running past this are stopped by the nightly job. The true elapsed time is kept, never truncated.",
    },
  ];

  return (
    <>
      <PageHeader
        title="Settings"
        description="Venture configuration and system-level switches."
      />

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Venture configuration
        </h2>
        <p className="mb-4 max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">
          Each venture keeps its own timezone, working week and daily-log cutoff. Business
          days and payroll periods follow these, so changing one affects how that venture&rsquo;s
          hours are counted.
        </p>

        {ventures.length === 0 ? (
          <EmptyState
            title="No ventures yet"
            description="Create a venture and its timezone, working week and daily-log cutoff appear here."
            action={
              <Link href="/ventures/new">
                <Button>Create venture</Button>
              </Link>
            }
          />
        ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-zinc-300 text-left text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
                <th className="pb-2 pr-4 font-medium">Venture</th>
                <th className="pb-2 pr-4 font-medium">Timezone</th>
                <th className="pb-2 pr-4 font-medium">Working week</th>
                <th className="pb-2 pr-4 font-medium">Log cutoff</th>
                <th className="pb-2 pr-4 font-medium">Currency</th>
                <th className="pb-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {ventures.map((v) => (
                <VentureSettingsRow
                  key={v.id}
                  venture={{
                    id: v.id,
                    slug: v.slug,
                    name: v.name,
                    tagColor: v.tagColor,
                    timezone: v.timezone,
                    workingDays: v.workingDays,
                    dailyLogEditWindowHours: v.dailyLogEditWindowHours,
                    defaultCurrency: v.defaultCurrency,
                    timezoneLocked: lockedTimezones.has(v.id),
                  }}
                />
              ))}
            </tbody>
          </table>
        </div>
        )}

        {ventures.length > 0 && (
          <div className="mt-4">
            <Link href="/ventures/new">
              <Button variant="secondary">Create venture</Button>
            </Link>
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          System
        </h2>
        <p className="mb-4 max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">
          These come from environment variables and change on deployment, not from this
          screen — so nobody can switch off an audit-relevant control from a browser.
        </p>

        <div className="space-y-2">
          {systemSettings.map((s) => (
            <Card key={s.label}>
              <div className="flex flex-wrap items-start gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-zinc-900 dark:text-zinc-100">
                    {s.label}
                  </div>
                  <div className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">
                    {s.detail}
                  </div>
                </div>
                <Badge tone={s.on ? "green" : "amber"}>{s.value}</Badge>
              </div>
            </Card>
          ))}
        </div>
      </section>
    </>
  );
}
