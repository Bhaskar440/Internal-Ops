# Setting up the database with pgAdmin

For running Portfolio Ops against the PostgreSQL 16 already installed on this
machine, using a GUI rather than the command line.

You will need the **postgres superuser password** — the one set when PostgreSQL
was installed. It is not stored anywhere in this project.

---

## 0. Install pgAdmin (once)

It is not currently installed. Either:

- Download from **https://www.pgadmin.org/download/pgadmin-4-windows/**, or
- Re-run the PostgreSQL 16 installer and tick **pgAdmin 4**

---

## 1. Connect to the server

1. Open pgAdmin. It asks for a **master password** — this is pgAdmin's own, for
   the saved-connection store. Set anything you will remember; it is unrelated
   to Postgres.
2. Left panel → right-click **Servers** → **Register → Server…**
3. **General** tab → Name: `Local PG16`
4. **Connection** tab:
   - Host: `localhost`
   - Port: `5433`
   - Maintenance database: `postgres`
   - Username: `postgres`
   - Password: your superuser password, tick **Save password**
5. **Save**

> Port **5433** is PostgreSQL 16. This machine also runs 18 on 5432 and 13 on
> 5434 — connecting to the wrong one creates the database in the wrong server.

---

## 2. Create the application role

The app does not connect as `postgres`. It gets its own limited role.

1. Expand **Local PG16** → right-click **Login/Group Roles** → **Create → Login/Group Role…**
2. **General** tab → Name: `portfolio_ops`
3. **Definition** tab → Password: `portfolio_ops_dev`
4. **Privileges** tab → turn ON:
   - **Can login?**
   - **Create databases?** — needed because the integration tests recreate
     their own database between runs
5. **Save**

> To use a different password, change it here and update both `DATABASE_URL`
> and `TEST_DATABASE_URL` in `.env` to match.

---

## 3. Create the two databases

Once for the app, once for tests. Tests wipe data between runs, so they must
never share a database with development work.

For **each** of `portfolio_ops` and `portfolio_ops_test`:

1. Right-click **Databases** → **Create → Database…**
2. Database: the name
3. Owner: `portfolio_ops`
4. **Save**

---

## 4. Grant the public schema

PostgreSQL 15 and later no longer let any user write to the `public` schema by
default, so the owner has to be granted it explicitly or Prisma cannot create
tables.

For **each** of the two databases:

1. Click the database → toolbar **Query Tool** (or Alt+Shift+Q)
2. Run:

   ```sql
   GRANT ALL ON SCHEMA public TO portfolio_ops;
   ```

Check the bottom panel says the query returned successfully.

---

## 5. Create the tables and the first admin

Back in a terminal, in `D:\NehaMehta\ERP`:

```powershell
npx prisma migrate deploy
npm run db:seed
```

`migrate deploy` creates the 23 tables. `db:seed` creates the three starting
ventures and the first Super Admin — **with no password** — then prints an
invitation link:

```
  The first Super Admin has NO password yet.
  Send gbgsweden2020@gmail.com this link so they can set their own:

    http://localhost:3000/invite/xxxxxxxxxxxxxxxxxxxx
```

Send that link to the account owner. They open it and choose their own
password, so nobody who ran the setup ever knows the credential. It expires in
7 days; re-run `npm run db:seed` to issue a new one.

---

## 6. Start the app

```powershell
npm run dev
```

Open http://localhost:3000. Until the invitation is accepted, the account is
`PENDING` and cannot sign in — that is the intended behaviour, not a fault.

---

## Browsing your data

This is the part that works like MongoDB Atlas's Collections view.

**In pgAdmin:** expand **Local PG16 → Databases → portfolio_ops → Schemas →
public → Tables**. Right-click any table → **View/Edit Data → All Rows**.

**Or without pgAdmin:**

```powershell
npm run db:studio
```

Prisma Studio opens a table browser in your web browser. It needs no
installation and reads the same database.

---

## If something fails

**"password authentication failed for user postgres"** — wrong superuser
password, or you are on the wrong port. Confirm 5433.

**"permission denied for schema public"** — step 4 was missed, or was run
against only one of the two databases.

**"database portfolio_ops does not exist"** — step 3 created it on a different
server. Check the port on the connection you registered.

**Prisma cannot reach the database** — confirm `DATABASE_URL` in `.env` names
port 5433, and that the `postgresql-x64-16` service is running
(`Get-Service postgresql*`).
