import { prisma } from "@/lib/db/client";

/**
 * Temporary foundation status page.
 *
 * Phase 0 built the database and core libraries but no product screens yet, so
 * this page exists to make the foundation visible and verifiable in the browser.
 * It is replaced by the real Overview dashboard (§9) in Phase 2.
 */

export const dynamic = "force-dynamic";

async function getStatus() {
  try {
    const [ventures, people, tasks, timeEntries, dailyLogs] = await Promise.all([
      prisma.venture.findMany({
        where: { archivedAt: null },
        orderBy: { name: "asc" },
        select: {
          id: true,
          name: true,
          slug: true,
          tagColor: true,
          timezone: true,
          defaultCurrency: true,
          workingDays: true,
          dailyLogEditWindowHours: true,
        },
      }),
      prisma.person.count(),
      prisma.task.count(),
      prisma.timeEntry.count(),
      prisma.dailyLog.count(),
    ]);
    return { ok: true as const, ventures, people, tasks, timeEntries, dailyLogs };
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : String(error) };
  }
}

const PHASES = [
  { n: 0, name: "Foundation — schema, DB, core libraries", done: true },
  { n: 1, name: "Auth, accounts, RBAC", done: false },
  { n: 2, name: "Ventures & People", done: false },
  { n: 3, name: "Tasks & Kanban", done: false },
  { n: 4, name: "Time tracking & timer", done: false },
  { n: 5, name: "Daily logs & approval", done: false },
];

export default async function Home() {
  const status = await getStatus();

  return (
    <div className="min-h-full bg-zinc-50 dark:bg-zinc-950">
      <div className="mx-auto max-w-4xl px-6 py-16">
        <header className="mb-12">
          <p className="text-xs font-medium uppercase tracking-widest text-blue-600 dark:text-blue-400">
            Internal system of record
          </p>
          <h1 className="mt-2 text-4xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Portfolio Ops
          </h1>
          <p className="mt-3 max-w-2xl text-zinc-600 dark:text-zinc-400">
            Cross-venture operations, HR, time tracking and payroll calculation.
            Foundation is in place; product screens are built phase by phase.
          </p>
        </header>

        {!status.ok ? (
          <section className="mb-10 rounded-lg border border-red-300 bg-red-50 p-5 dark:border-red-900 dark:bg-red-950/40">
            <h2 className="font-medium text-red-900 dark:text-red-200">
              Cannot reach the database
            </h2>
            <p className="mt-2 text-sm text-red-800 dark:text-red-300">
              Start it with <code className="font-mono">npm run db:up</code>, then reload.
              Docker Desktop must be running first.
            </p>
            <pre className="mt-3 overflow-x-auto rounded bg-red-100 p-3 text-xs text-red-900 dark:bg-red-900/40 dark:text-red-200">
              {status.error}
            </pre>
          </section>
        ) : (
          <>
            <section className="mb-10">
              <h2 className="mb-4 text-sm font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                Ventures
              </h2>
              {status.ventures.length === 0 ? (
                <p className="rounded-lg border border-dashed border-zinc-300 p-6 text-sm text-zinc-500 dark:border-zinc-700">
                  No ventures yet. Run <code className="font-mono">npm run db:seed</code>.
                </p>
              ) : (
                <ul className="grid gap-3 sm:grid-cols-3">
                  {status.ventures.map((v) => (
                    <li
                      key={v.id}
                      className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
                    >
                      <span
                        className="inline-block h-2 w-2 rounded-full"
                        style={{ backgroundColor: v.tagColor }}
                        aria-hidden
                      />
                      <h3 className="mt-2 font-medium text-zinc-900 dark:text-zinc-100">
                        {v.name}
                      </h3>
                      <dl className="mt-2 space-y-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                        <div>{v.timezone}</div>
                        <div>
                          {v.defaultCurrency} · {v.workingDays.length}-day week
                        </div>
                        <div>{v.dailyLogEditWindowHours}h edit window</div>
                      </dl>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="mb-10">
              <h2 className="mb-4 text-sm font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                Core chain
              </h2>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  { label: "People", value: status.people },
                  { label: "Tasks", value: status.tasks },
                  { label: "Time entries", value: status.timeEntries },
                  { label: "Daily logs", value: status.dailyLogs },
                ].map((s) => (
                  <div
                    key={s.label}
                    className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
                  >
                    <div className="text-2xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
                      {s.value}
                    </div>
                    <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                      {s.label}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </>
        )}

        <section>
          <h2 className="mb-4 text-sm font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Build progress
          </h2>
          <ol className="overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
            {PHASES.map((p) => (
              <li
                key={p.n}
                className="flex items-center gap-3 border-b border-zinc-100 px-4 py-3 last:border-0 dark:border-zinc-800"
              >
                <span
                  className={
                    p.done
                      ? "flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-green-600 text-[11px] font-bold text-white"
                      : "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-zinc-300 text-[11px] text-zinc-400 dark:border-zinc-700"
                  }
                >
                  {p.done ? "✓" : p.n}
                </span>
                <span
                  className={
                    p.done
                      ? "text-sm text-zinc-900 dark:text-zinc-100"
                      : "text-sm text-zinc-400 dark:text-zinc-500"
                  }
                >
                  Phase {p.n}: {p.name}
                </span>
              </li>
            ))}
          </ol>
          <p className="mt-4 text-sm text-zinc-500 dark:text-zinc-400">
            Login, dashboards and the Kanban board arrive in Phases 1–3. This page is
            replaced by the Overview dashboard once People &amp; Ventures ship.
          </p>
        </section>
      </div>
    </div>
  );
}
