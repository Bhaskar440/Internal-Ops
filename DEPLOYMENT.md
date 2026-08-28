# Deploying Portfolio Ops

Target: **Vercel** for the application, **managed PostgreSQL** for the database.

You will need to create accounts and paste credentials — those steps cannot be
automated for you. Everything else is already configured in the repository.

Budget about an hour for a first deployment.

---

## Before you start

Have these ready:

- A **GitHub** (or GitLab/Bitbucket) repository with this code pushed to it
- A **Vercel** account — https://vercel.com/signup
- A **managed Postgres** provider. Any works; these are the common choices:
  - **Neon** (https://neon.tech) — generous free tier, quick setup
  - **Supabase** (https://supabase.com)
  - **Vercel Postgres** — fewest moving parts if you are already on Vercel
- Optionally a **Resend** account (https://resend.com) for email
- A domain, if you want something other than a `.vercel.app` address

---

## 1. Create the production database

Create a Postgres instance and copy its connection string. It looks like:

```
postgresql://user:password@host.region.provider.tech/dbname?sslmode=require
```

Two things to confirm with your provider before going further:

- **Automated daily backups are on.** Most managed providers enable these by
  default, but check rather than assume.
- **Encryption at rest** is enabled (§63).

> **Connection pooling.** Serverless functions open many short-lived
> connections. Neon and Supabase both offer a *pooled* connection string —
> use it for `DATABASE_URL`. If your provider distinguishes pooled from direct
> URLs, the pooled one is what this app wants.

---

## 2. Generate your production secrets

Run these locally and keep the output somewhere safe. **Do not reuse the values
from your development `.env`.**

```bash
# AUTH_SECRET — signs session cookies
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

# CRON_SECRET — protects the scheduled-jobs endpoint
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## 3. Import the project into Vercel

1. In Vercel, **Add New → Project**, and pick your repository.
2. Framework preset is detected as **Next.js**. Leave the defaults — the build
   command lives in `vercel.json` and already runs migrations:
   `prisma generate && prisma migrate deploy && next build`
3. **Do not deploy yet.** Add the environment variables first.

---

## 4. Set environment variables

In **Project → Settings → Environment Variables**, add these for
**Production** (and Preview, if you use preview deployments):

| Variable | Value |
|---|---|
| `DATABASE_URL` | Your pooled Postgres connection string |
| `AUTH_SECRET` | The value generated in step 2 |
| `AUTH_URL` | Your real URL, e.g. `https://ops.yourcompany.com` |
| `AUTH_TRUST_HOST` | `true` |
| `CRON_SECRET` | The value generated in step 2 |
| `FEATURE_MY_PAY_ENABLED` | `false` unless you have decided otherwise |
| `TIMER_REVIEW_THRESHOLD_HOURS` | `12` |
| `TIMER_AUTO_STOP_HOURS` | `24` |

Email, once you have a Resend account:

| Variable | Value |
|---|---|
| `RESEND_API_KEY` | Your Resend API key |
| `EMAIL_FROM` | `Portfolio Ops <ops@yourdomain.com>` |

`AUTH_URL` matters: invitation and password-reset links are built from it. If
it is wrong, those links point somewhere useless.

`TEST_DATABASE_URL` is **not** needed in production — it is only for running
integration tests locally.

---

## 5. Deploy

Trigger the deployment. The build runs `prisma migrate deploy`, so the schema
is created on first deploy — no manual SQL.

Watch the build log for the migration step. If it fails, the usual cause is a
`DATABASE_URL` that is unreachable or missing `?sslmode=require`.

---

## 6. Create the first Super Admin

The seed script does not run automatically — deliberately, so a deployment can
never quietly reset production data.

Run it once against production from your machine:

```bash
DATABASE_URL="<your production connection string>" \
SEED_SUPER_ADMIN_EMAIL="you@yourcompany.com" \
SEED_SUPER_ADMIN_PASSWORD="<a strong password>" \
SEED_SUPER_ADMIN_NAME="Your Name" \
npx tsx prisma/seed.ts
```

This creates the admin plus the three initial ventures. It is idempotent —
running it twice will not duplicate anything.

**Sign in and change that password immediately**, then delete it from your
shell history.

---

## 7. Add your domain

**Project → Settings → Domains**, add your domain and follow the DNS
instructions. Vercel provisions the TLS certificate automatically.

Update `AUTH_URL` to the final domain and redeploy so links are correct.

---

## 8. Confirm the scheduled job

`vercel.json` registers a daily cron at **19:00 UTC** (00:30 IST) hitting
`/api/cron/stale-timers`. It force-stops abandoned timers and prunes old
login-attempt rows.

Check it under **Project → Settings → Cron Jobs** after the first deploy.
Vercel sends `CRON_SECRET` as a Bearer token automatically.

Test it manually:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  https://your-domain.com/api/cron/stale-timers
```

Expect `{"ok":true,...}`. A 401 means `CRON_SECRET` does not match; a 503
means it is not set.

> Cron jobs need a Vercel Pro plan. On Hobby, run the same authenticated
> request from any external scheduler (GitHub Actions, cron-job.org, a server
> crontab) — the endpoint does not care who calls it.

---

## 9. Smoke test production

Sign in as the admin and walk the flow once with real data:

1. Create a venture — check its timezone and currency
2. Add a person and confirm they receive the invitation email
   (or copy the link if email is not configured yet)
3. Accept the invitation in a private window and set a password
4. Create a task with an estimate, assign it
5. Start and stop a timer, add manual hours, submit the day
6. Approve it as admin, check efficiency appears
7. Set a pay rate, create a payroll run, generate, review, **do not lock**
   until the numbers look right
8. Export the CSV and confirm the amounts
9. Open the audit log and confirm the actions are recorded

---

## Ongoing operations

**Backups.** Your provider's automated backups are not a backup until you have
restored one. Do a test restore into a scratch database before you rely on it
(§65).

**Migrations.** Schema changes deploy automatically with the build. The order
is always migrate → deploy → smoke test (§67). Never edit the production
schema by hand.

**Monitoring.** Add Sentry or similar for error tracking (§63). Not configured
here since it needs your account.

**Staging.** Vercel preview deployments give you this: point a preview
environment at a *separate* database. Never test payroll against production
data (§66).

---

## Rolling back

- **Application:** Vercel → Deployments → an earlier deployment → Promote.
- **Database:** Prisma migrations do not auto-revert. Restore from a backup, or
  write a corrective migration. This is why testing the restore matters.

---

## What Portfolio Ops does not do

By design (§34, §86): it does not move money, calculate or file tax, store
document files, or act as an accounting ledger. It calculates **gross payable
amounts** and exports CSV. Payment happens in your bank or payroll provider.
