#!/usr/bin/env bash
#
# Point Portfolio Ops at a natively-installed PostgreSQL instead of Docker.
#
# Creates the portfolio_ops role and its two databases (development and test),
# then applies migrations and seeds. Safe to re-run: every step is idempotent.
#
# Usage:
#   PGPASSWORD='<your postgres superuser password>' bash scripts/setup-local-postgres.sh
#
# Optional overrides:
#   PGPORT   port of the target server            (default 5433, PostgreSQL 16)
#   PGHOST   host                                 (default localhost)
#   PG_BIN   directory containing psql.exe        (default the v16 install)
#   APP_PASSWORD  password for the portfolio_ops role (default portfolio_ops_dev)

set -euo pipefail

PGHOST="${PGHOST:-localhost}"
PGPORT="${PGPORT:-5433}"
PG_BIN="${PG_BIN:-/c/Program Files/PostgreSQL/16/bin}"
APP_PASSWORD="${APP_PASSWORD:-portfolio_ops_dev}"
PSQL="$PG_BIN/psql.exe"

export PGCLIENTENCODING=UTF8

if [ -z "${PGPASSWORD:-}" ]; then
  echo "PGPASSWORD is not set. Re-run as:" >&2
  echo "  PGPASSWORD='your-password' bash scripts/setup-local-postgres.sh" >&2
  exit 1
fi

if [ ! -x "$PSQL" ]; then
  echo "psql not found at: $PSQL" >&2
  echo "Set PG_BIN to the bin directory of your PostgreSQL install." >&2
  exit 1
fi

su() { "$PSQL" -w -h "$PGHOST" -p "$PGPORT" -U postgres -v ON_ERROR_STOP=1 "$@"; }

echo "==> Connecting to $PGHOST:$PGPORT"
su -tAc "select 'connected to ' || version();"

# CREATE ROLE / DATABASE have no IF NOT EXISTS, so guard each with a lookup.
echo "==> Creating role portfolio_ops"
if [ "$(su -tAc "select 1 from pg_roles where rolname='portfolio_ops';")" = "1" ]; then
  su -c "ALTER ROLE portfolio_ops WITH LOGIN PASSWORD '$APP_PASSWORD' CREATEDB;"
  echo "    role already existed - password and CREATEDB refreshed"
else
  su -c "CREATE ROLE portfolio_ops WITH LOGIN PASSWORD '$APP_PASSWORD' CREATEDB;"
  echo "    created"
fi

# CREATEDB is granted because the integration-test harness drops and recreates
# its own database between runs.

for db in portfolio_ops portfolio_ops_test; do
  echo "==> Creating database $db"
  if [ "$(su -tAc "select 1 from pg_database where datname='$db';")" = "1" ]; then
    echo "    already exists - left untouched"
  else
    su -c "CREATE DATABASE $db OWNER portfolio_ops;"
    echo "    created"
  fi
  # Prisma creates objects in the public schema; on PG 15+ that is no longer
  # world-writable, so the owner needs it granted explicitly.
  su -d "$db" -c "GRANT ALL ON SCHEMA public TO portfolio_ops;"
done

echo
echo "==> Databases ready. Applying migrations."
cd "$(dirname "$0")/.."
npx prisma migrate deploy

echo
echo "==> Seeding"
npm run db:seed

echo
echo "Done. Portfolio Ops is now running on native PostgreSQL at $PGHOST:$PGPORT."
