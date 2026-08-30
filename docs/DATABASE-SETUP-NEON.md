# Setting up the database on Neon

Neon is hosted PostgreSQL with a web console — the equivalent of MongoDB Atlas.
No Docker, and the same arrangement the client will use at handover.

You need a Neon account. The free tier is enough for testing.

---

## 1. Create the project

In the Neon console → **New project**:

| Field | Value |
|---|---|
| Name | `portfolio-ops` |
| Postgres version | **16** |
| Region | **AWS Asia Pacific (Mumbai)**, or Singapore if Mumbai is unavailable |

Version 16 is what this project is built and tested against. Region matters
because the ventures run on `Asia/Kolkata` — a closer region means faster
queries.

---

## 2. Copy the pooled connection string

After creating the project Neon shows a connection string. **Use the pooled
one** — look for a "Pooled connection" toggle, or a host containing `-pooler`:

```
postgresql://user:password@ep-something-pooler.ap-south-1.aws.neon.tech/neondb?sslmode=require
```

The direct (non-pooled) URL opens one connection per request and runs out under
a serverless app. Keep `?sslmode=require` — Neon rejects unencrypted
connections.

---

## 3. Create a branch for tests

The integration tests **delete rows as they run**. They must never share a
database with your real data.

Neon branches are isolated copies, which makes this cheap:

1. Project → **Branches** → **New branch**
2. Name: `test`
3. Create from: `main`
4. **Create**
5. Copy that branch's **pooled** connection string too

You now have two connection strings that differ only in the endpoint id.

---

## 4. Put them in `.env`

Open `.env` and replace both placeholder lines:

```
DATABASE_URL="<pooled connection string for the MAIN branch>"
TEST_DATABASE_URL="<pooled connection string for the TEST branch>"
```

Do not swap them. `DATABASE_URL` is what the app reads; `TEST_DATABASE_URL` is
what gets wiped.

> The test setup refuses to run if both point at the same database, so a bad
> paste fails loudly instead of destroying your data.

`.env` is gitignored and never committed.

---

## 5. Create the tables

```powershell
npx prisma migrate deploy
```

This creates all 23 tables on the main branch. Run it once against the test
branch as well, so the tests have a schema to work with:

```powershell
$env:PRISMA_TARGET_TEST = "1"; npx prisma migrate deploy
Remove-Item Env:\PRISMA_TARGET_TEST
```

---

## 6. Seed and start

```powershell
npm run db:seed     # ventures + the first Super Admin (prints an invite link)
npm run db:demo     # optional: demo people, tasks, hours, a payroll run
npm run dev
```

`db:demo` also activates the admin account for testing:
`admin@portfolioops.local` / `DemoPassword123`.

Without `db:demo`, the admin account has **no password** — it is waiting on the
invitation link that `db:seed` printed. That is the intended handover
behaviour.

Open http://localhost:3000.

---

## Browsing your data

Neon console → your project → **Tables**. This is the Atlas-style browser: pick
a table, see the rows, run SQL in the **SQL Editor** tab.

`npm run db:studio` also works and reads the same database.

---

## Handing over to the client

Nothing in the code changes. The client creates their own Neon project (or any
hosted Postgres), and `DATABASE_URL` is set to their connection string in the
deployment's environment variables — not in a file.

Your personal Neon project is then disconnected entirely; their data never
touches it. See [DEPLOYMENT.md](../DEPLOYMENT.md).

---

## If something fails

**`password authentication failed`** — the string was copied incompletely.
Re-copy it; Neon passwords are long and easy to truncate.

**`too many connections`** — you used the direct URL. Switch to the pooled one.

**`no pg_hba.conf entry ... no encryption`** — `?sslmode=require` is missing
from the end of the string.

**Tests refuse to start with "point at the same database"** — both variables
hold the same branch. Re-copy the test branch's string.

**`relation "users" does not exist`** — `prisma migrate deploy` has not run
against that branch yet. See step 5.
