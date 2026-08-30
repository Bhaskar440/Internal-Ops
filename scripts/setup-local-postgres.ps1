# Point Portfolio Ops at your local PostgreSQL 16 instead of Docker.
#
# Prompts for the postgres superuser password, creates the portfolio_ops role
# and its two databases, applies migrations, then seeds the first Super Admin.
#
# Run from PowerShell:
#   .\scripts\setup-local-postgres.ps1
#
# Nothing is written to disk: both passwords are read into memory for this run
# only. Re-running is safe; every step checks before it creates.

param(
  [int]$Port = 5433,
  [string]$PgBin = "C:\Program Files\PostgreSQL\16\bin",
  [string]$AppPassword = "portfolio_ops_dev"
)

$ErrorActionPreference = "Stop"
$psql = Join-Path $PgBin "psql.exe"

if (-not (Test-Path $psql)) {
  Write-Host "psql not found at $psql" -ForegroundColor Red
  Write-Host "Pass -PgBin with the bin folder of your PostgreSQL install."
  exit 1
}

Write-Host ""
Write-Host "Portfolio Ops - local PostgreSQL setup" -ForegroundColor Cyan
Write-Host "Target: localhost:$Port"
Write-Host ""

# Read-Host -AsSecureString keeps the password off the screen and out of the
# PowerShell history that a plain parameter would land in.
$secure = Read-Host "postgres superuser password" -AsSecureString
$env:PGPASSWORD = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto(
  [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
$env:PGCLIENTENCODING = "UTF8"

function Invoke-Sql([string]$sql, [string]$db = "postgres") {
  & $psql -w -h localhost -p $Port -U postgres -d $db -v ON_ERROR_STOP=1 -tAc $sql
  if ($LASTEXITCODE -ne 0) { throw "psql failed" }
}

try {
  Write-Host "==> Connecting" -ForegroundColor Yellow
  Invoke-Sql "select 'connected to ' || version();"

  Write-Host "==> Role portfolio_ops" -ForegroundColor Yellow
  # CREATE ROLE has no IF NOT EXISTS, so check first. CREATEDB is granted
  # because the integration tests recreate their own database between runs.
  $exists = Invoke-Sql "select 1 from pg_roles where rolname='portfolio_ops';"
  if ($exists -eq "1") {
    Invoke-Sql "ALTER ROLE portfolio_ops WITH LOGIN PASSWORD '$AppPassword' CREATEDB;"
    Write-Host "    existed - password refreshed"
  } else {
    Invoke-Sql "CREATE ROLE portfolio_ops WITH LOGIN PASSWORD '$AppPassword' CREATEDB;"
    Write-Host "    created"
  }

  foreach ($db in @("portfolio_ops", "portfolio_ops_test")) {
    Write-Host "==> Database $db" -ForegroundColor Yellow
    $has = Invoke-Sql "select 1 from pg_database where datname='$db';"
    if ($has -eq "1") {
      Write-Host "    already exists - left untouched"
    } else {
      Invoke-Sql "CREATE DATABASE $db OWNER portfolio_ops;"
      Write-Host "    created"
    }
    # On PG 15+ the public schema is no longer world-writable, so the owner
    # needs it granted explicitly before Prisma can create tables.
    Invoke-Sql "GRANT ALL ON SCHEMA public TO portfolio_ops;" $db
  }
}
finally {
  # Do not leave the superuser password sitting in the session.
  Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
}

Write-Host ""
Write-Host "==> Applying migrations" -ForegroundColor Yellow
npx prisma migrate deploy
if ($LASTEXITCODE -ne 0) { exit 1 }

Write-Host ""
Write-Host "==> Seeding" -ForegroundColor Yellow
# The seed sets no password: it prints an invitation link for the first Super
# Admin, who chooses their own.
npm run db:seed
if ($LASTEXITCODE -ne 0) { exit 1 }

Write-Host ""
Write-Host "Done. Portfolio Ops is on local PostgreSQL at localhost:$Port." -ForegroundColor Green
Write-Host "Start it with:  npm run dev"
