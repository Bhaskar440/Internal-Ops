# Portfolio Ops

Internal operating system for cross-venture operations, HR, time tracking,
attendance, reporting and payroll calculation.

The core chain is deliberate and never broken:

```
Person → Venture → Task → Time Entry → Daily Log → Approval → Reporting → Payroll Snapshot → Audit
```

There is **one source of truth for time**. A three-hour entry feeds task actual
hours, the person's day, venture totals, efficiency reporting and payable hours
from the same row.

---

## Running it locally

**Prerequisites:** Node 22+, Docker Desktop (must be running).

```bash
npm install
cp .env.example .env          # then set AUTH_SECRET (see below)
npm run db:setup              # create the role + databases on local Postgres 16
npm run db:migrate            # apply migrations
npm run db:seed               # first Super Admin + three ventures
npm run dev                   # http://localhost:3000
```

Generate a secret for `.env`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Sign in with the seeded account and **change the password immediately**:

```
admin@portfolioops.local / ChangeMe!2026
```

> The app connects to your local PostgreSQL 16 on port 5433. Docker is not required;
> already occupy the default range. Change them in `docker-compose.yml` and
> `.env` together if you need to.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm test` | Full test suite (needs the test database up) |
| `npm run typecheck` | TypeScript, no emit |
| `npm run lint` | ESLint |
| `npm run db:up` / `db:down` | Start / stop Postgres |
| `npm run db:migrate` | Apply migrations in development |
| `npm run db:seed` | Seed the first admin and ventures (idempotent) |
| `npm run db:demo` | Fill with demo people, tasks, hours and payroll for evaluation |
| `npm run db:demo:clear` | Remove everything the demo seed created |
| `npm run db:studio` | Browse the database |

**Want something to click through?** `npm run db:demo` adds eight fictional
people across the three ventures, fourteen tasks, a few weeks of approved
hours, a day awaiting approval, hardware and an expiring document. Demo
accounts sign in with `DemoPassword123` — for example
`aarav@demo.portfolioops.local` (a manager) or `neha@demo.portfolioops.local`
(a member). It is kept separate from the real seed, refuses to run against a
non-local database, and `npm run db:demo:clear` removes exactly what it added.

Verify the whole business flow end to end against the dev database — it creates
a venture, employee, task, hours, approval, payroll run, then cleans up:

```bash
npx tsx scripts/verify-flow.mts
```

---

## Architecture

Modular monolith. Strict layering, no database or business logic in components:

```
UI → route handler / server action → guard (authz) → Zod validation → service → Prisma → Postgres
```

```
prisma/            schema.prisma, migrations, seed
src/app/(auth)/    login, invite, forgot-password, reset-password
src/app/(admin)/   dashboard, my-day, tasks, approvals, people,
                   ventures, reports, payroll, hr, audit
src/app/api/       auth, report + payroll CSV export
src/modules/       ventures people tasks time dailyLogs reports
                   compensation payroll hr audit
src/lib/           db auth permissions timezone money errors utils
tests/unit/        pure logic — efficiency, timezone, permissions
tests/integration/ real Postgres — scoping, timers, payroll, auth
```

### Rules the code enforces structurally

These are not conventions; they are enforced so they cannot quietly regress.

- **One running timer per person** — a partial unique index in Postgres, not
  just a service check. A second timer is rejected by the database.
- **Task actual hours are never stored** — always summed from time entries.
  A test fails if an `actual_hours` column ever appears.
- **Daily logs hold no total** — the day's hours are a projection over time
  entries, so timer and manual time cannot double count.
- **Estimates are integer minutes**, never float hours. Money is
  `Decimal(18,4)`, never a float.
- **Business dates are venture-local.** A timer crossing midnight stays one row
  on its start date.
- **Aggregate efficiency is `SUM(estimated) / SUM(actual)`**, never a mean of
  percentages.
- **Payroll lines snapshot everything** used in their calculation, so a later
  raise cannot alter a locked run.
- **Pay data lives only in the compensation module.** The people directory
  never selects a rate.
- **Authorization is server-side on every request.** Hidden buttons are not
  security.

---

## Roles

Three independent axes, as the spec requires:

| Axis | Values |
|---|---|
| Global role | `SUPER_ADMIN`, `USER` |
| Venture access | `MANAGER`, `MEMBER` (per venture) |
| Employment type | `EMPLOYEE`, `FREELANCER`, `CONTRACTOR` |

A freelancer can manage a venture. Employment type never grants access.

Managers see only their own ventures, approve daily logs there, and have **no
access to pay data**. Super Admins see everything.

---

## Configuration

Settings live in `.env` (see `.env.example`):

| Variable | Purpose |
|---|---|
| `DATABASE_URL` / `TEST_DATABASE_URL` | Postgres connections |
| `AUTH_SECRET` | Session signing — must be unique per environment |
| `AUTH_URL` | Base URL, used in invitation and reset links |
| `FEATURE_MY_PAY_ENABLED` | Whether employees see their own computed pay |
| `TIMER_REVIEW_THRESHOLD_HOURS` | Long timers flagged for review (default 12) |
| `TIMER_AUTO_STOP_HOURS` | Abandoned timers force-stopped (default 24) |

Per-venture settings — timezone, working week, daily-log edit window, currency —
are configured in the app, not in code.

---

## Before going live

**Required:**

1. **Change the seeded admin password**, or seed with a different one.
2. **Set a fresh `AUTH_SECRET`** per environment. Never reuse the dev value.
3. **Use managed Postgres** with automated backups and encryption at rest —
   and *test a restore* before you rely on it.
4. **Serve over HTTPS only.** Set `AUTH_URL` to the real domain.
5. **Run migrations before deploying** the new build: migrate → deploy → smoke test.

**Configure when ready:**

- **Email delivery.** Set `RESEND_API_KEY` and `EMAIL_FROM` to switch on all
  outbound mail: invitations, password resets, and the three registration
  emails (request received / an admin is needed / your account is ready).
  Without them, invitation and reset links are shown in the UI for an
  administrator to pass on — no code change either way. Resend's free tier is
  3,000 emails a month, but it requires a domain you own and have verified.
- **Scheduled jobs.** `/api/cron/stale-timers` stops abandoned timers and prunes
  login-attempt rows. It needs `CRON_SECRET`; `vercel.json` already registers it
  to run daily at 19:00 UTC.
- **Error monitoring** — Sentry or equivalent.

**Deploying:** see [DEPLOYMENT.md](DEPLOYMENT.md) for the full Vercel and
managed-Postgres walkthrough.

**Deliberately out of scope** (§86): bank transfers, tax calculation or filing,
document file storage, accounting ledger, expense reimbursement, recruitment,
appraisals, leave balances, biometric attendance, GPS tracking.

Portfolio Ops calculates **gross payable amounts only** and exports CSV. Payment
happens in your bank or payroll provider.

---

## Testing

```bash
npm run db:up      # test database must be running
npm test
```

Unit tests cover efficiency, timezone boundaries (including DST), duration
conversion and the permission matrix. Integration tests run against a real
Postgres and cover cross-venture isolation, the timer constraint, daily-log
non-duplication, payroll arithmetic and snapshot immutability, and login
rate limiting.

Integration tests refuse to run against a non-local database.
