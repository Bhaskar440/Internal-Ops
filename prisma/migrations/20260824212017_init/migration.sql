-- CreateEnum
CREATE TYPE "GlobalRole" AS ENUM ('SUPER_ADMIN', 'USER');

-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED', 'INACTIVE');

-- CreateEnum
CREATE TYPE "EmploymentType" AS ENUM ('EMPLOYEE', 'FREELANCER', 'CONTRACTOR');

-- CreateEnum
CREATE TYPE "VentureAccessRole" AS ENUM ('MANAGER', 'MEMBER');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('BACKLOG', 'IN_PROGRESS', 'REVIEW', 'DONE');

-- CreateEnum
CREATE TYPE "TaskPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "TimeEntrySource" AS ENUM ('TIMER', 'MANUAL', 'ADMIN_ADJUSTMENT');

-- CreateEnum
CREATE TYPE "TimeEntryApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'NEEDS_REVIEW');

-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('PRESENT', 'REMOTE', 'ON_LEAVE', 'ABSENT');

-- CreateEnum
CREATE TYPE "DailyLogStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'LOCKED');

-- CreateEnum
CREATE TYPE "HardwareAssetStatus" AS ENUM ('AVAILABLE', 'ISSUED', 'IN_REPAIR', 'RETIRED', 'LOST');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('PENDING', 'SUBMITTED', 'VERIFIED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "PayType" AS ENUM ('HOURLY', 'MONTHLY_FIXED', 'PER_TASK');

-- CreateEnum
CREATE TYPE "ProrationPolicy" AS ENUM ('FIXED_FULL', 'ATTENDANCE_PRORATED');

-- CreateEnum
CREATE TYPE "PayrollRunStatus" AS ENUM ('DRAFT', 'REVIEW', 'LOCKED', 'PAID', 'VOID');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('UNPAID', 'PAID');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "password_hash" TEXT,
    "global_role" "GlobalRole" NOT NULL DEFAULT 'USER',
    "account_status" "AccountStatus" NOT NULL DEFAULT 'PENDING',
    "auth_provider_id" TEXT,
    "email_verified" TIMESTAMP(3),
    "image" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_account_id" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "session_token" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_tokens" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "people" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "employment_type" "EmploymentType" NOT NULL,
    "start_date" DATE,
    "end_date" DATE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "archived_at" TIMESTAMP(3),

    CONSTRAINT "people_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ventures" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "tag_color" TEXT NOT NULL DEFAULT '#2563eb',
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "working_days" INTEGER[] DEFAULT ARRAY[1, 2, 3, 4, 5]::INTEGER[],
    "daily_log_edit_window_hours" INTEGER NOT NULL DEFAULT 48,
    "default_currency" TEXT NOT NULL DEFAULT 'INR',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "archived_at" TIMESTAMP(3),

    CONSTRAINT "ventures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "venture_memberships" (
    "id" TEXT NOT NULL,
    "venture_id" TEXT NOT NULL,
    "person_id" TEXT NOT NULL,
    "access_role" "VentureAccessRole" NOT NULL DEFAULT 'MEMBER',
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "left_at" TIMESTAMP(3),

    CONSTRAINT "venture_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tasks" (
    "id" TEXT NOT NULL,
    "venture_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "TaskStatus" NOT NULL DEFAULT 'BACKLOG',
    "priority" "TaskPriority" NOT NULL DEFAULT 'MEDIUM',
    "estimated_minutes" INTEGER NOT NULL,
    "due_date" DATE,
    "board_order" INTEGER NOT NULL DEFAULT 0,
    "fixed_fee" DECIMAL(18,4),
    "fee_currency" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "archived_at" TIMESTAMP(3),

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_assignees" (
    "id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "person_id" TEXT NOT NULL,
    "assigned_by" TEXT NOT NULL,
    "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_assignees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_status_history" (
    "id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "from_status" "TaskStatus",
    "to_status" "TaskStatus" NOT NULL,
    "changed_by" TEXT NOT NULL,
    "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "time_entries" (
    "id" TEXT NOT NULL,
    "task_id" TEXT,
    "person_id" TEXT NOT NULL,
    "venture_id" TEXT NOT NULL,
    "daily_log_id" TEXT,
    "source" "TimeEntrySource" NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL,
    "ended_at" TIMESTAMP(3),
    "duration_seconds" INTEGER,
    "business_date" DATE NOT NULL,
    "note" TEXT,
    "approval_status" "TimeEntryApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "time_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_logs" (
    "id" TEXT NOT NULL,
    "person_id" TEXT NOT NULL,
    "venture_id" TEXT NOT NULL,
    "business_date" DATE NOT NULL,
    "attendance_status" "AttendanceStatus" NOT NULL DEFAULT 'PRESENT',
    "status" "DailyLogStatus" NOT NULL DEFAULT 'DRAFT',
    "general_note" TEXT,
    "submitted_at" TIMESTAMP(3),
    "approved_at" TIMESTAMP(3),
    "approved_by" TEXT,
    "rejection_reason" TEXT,
    "locked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "daily_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hardware_assets" (
    "id" TEXT NOT NULL,
    "item_name" TEXT NOT NULL,
    "asset_tag" TEXT,
    "serial_number" TEXT,
    "status" "HardwareAssetStatus" NOT NULL DEFAULT 'AVAILABLE',
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hardware_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_assignments" (
    "id" TEXT NOT NULL,
    "asset_id" TEXT NOT NULL,
    "person_id" TEXT NOT NULL,
    "issued_at" TIMESTAMP(3) NOT NULL,
    "issued_by" TEXT NOT NULL,
    "issue_condition" TEXT,
    "returned_at" TIMESTAMP(3),
    "returned_to" TEXT,
    "return_condition" TEXT,

    CONSTRAINT "asset_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_records" (
    "id" TEXT NOT NULL,
    "person_id" TEXT NOT NULL,
    "doc_type" TEXT NOT NULL,
    "status" "DocumentStatus" NOT NULL DEFAULT 'PENDING',
    "expiry_date" DATE,
    "external_reference_link" TEXT,
    "notes" TEXT,
    "verified_by" TEXT,
    "verified_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "document_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compensation_agreements" (
    "id" TEXT NOT NULL,
    "person_id" TEXT NOT NULL,
    "pay_type" "PayType" NOT NULL,
    "currency" TEXT NOT NULL,
    "rate" DECIMAL(18,4) NOT NULL,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "proration_policy" "ProrationPolicy" NOT NULL DEFAULT 'FIXED_FULL',
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "compensation_agreements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_runs" (
    "id" TEXT NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "status" "PayrollRunStatus" NOT NULL DEFAULT 'DRAFT',
    "generated_at" TIMESTAMP(3),
    "generated_by" TEXT,
    "locked_at" TIMESTAMP(3),
    "locked_by" TEXT,
    "void_reason" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payroll_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_lines" (
    "id" TEXT NOT NULL,
    "payroll_run_id" TEXT NOT NULL,
    "person_id" TEXT NOT NULL,
    "pay_type_snapshot" "PayType" NOT NULL,
    "currency" TEXT NOT NULL,
    "rate_snapshot" DECIMAL(18,4) NOT NULL,
    "approved_minutes" INTEGER NOT NULL,
    "eligible_days" INTEGER,
    "working_days" INTEGER,
    "computed_pay" DECIMAL(18,4) NOT NULL,
    "payment_status" "PaymentStatus" NOT NULL DEFAULT 'UNPAID',
    "paid_at" TIMESTAMP(3),
    "paid_by" TEXT,
    "payment_reference" TEXT,

    CONSTRAINT "payroll_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_adjustments" (
    "id" TEXT NOT NULL,
    "person_id" TEXT NOT NULL,
    "source_payroll_line_id" TEXT,
    "amount" DECIMAL(18,4) NOT NULL,
    "currency" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settled_payroll_line_id" TEXT,

    CONSTRAINT "payroll_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "actor_user_id" TEXT,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "before_json" JSONB,
    "after_json" JSONB,
    "reason" TEXT,
    "ip_address" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_account_status_idx" ON "users"("account_status");

-- CreateIndex
CREATE INDEX "users_created_at_idx" ON "users"("created_at");

-- CreateIndex
CREATE INDEX "accounts_user_id_idx" ON "accounts"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_provider_provider_account_id_key" ON "accounts"("provider", "provider_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_session_token_key" ON "sessions"("session_token");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "verification_tokens_token_key" ON "verification_tokens"("token");

-- CreateIndex
CREATE UNIQUE INDEX "verification_tokens_identifier_token_key" ON "verification_tokens"("identifier", "token");

-- CreateIndex
CREATE UNIQUE INDEX "people_user_id_key" ON "people"("user_id");

-- CreateIndex
CREATE INDEX "people_employment_type_idx" ON "people"("employment_type");

-- CreateIndex
CREATE INDEX "people_archived_at_idx" ON "people"("archived_at");

-- CreateIndex
CREATE UNIQUE INDEX "ventures_slug_key" ON "ventures"("slug");

-- CreateIndex
CREATE INDEX "ventures_active_idx" ON "ventures"("active");

-- CreateIndex
CREATE INDEX "ventures_archived_at_idx" ON "ventures"("archived_at");

-- CreateIndex
CREATE INDEX "venture_memberships_person_id_idx" ON "venture_memberships"("person_id");

-- CreateIndex
CREATE INDEX "venture_memberships_venture_id_access_role_idx" ON "venture_memberships"("venture_id", "access_role");

-- CreateIndex
CREATE UNIQUE INDEX "venture_memberships_venture_id_person_id_key" ON "venture_memberships"("venture_id", "person_id");

-- CreateIndex
CREATE INDEX "tasks_venture_id_status_idx" ON "tasks"("venture_id", "status");

-- CreateIndex
CREATE INDEX "tasks_status_idx" ON "tasks"("status");

-- CreateIndex
CREATE INDEX "tasks_due_date_idx" ON "tasks"("due_date");

-- CreateIndex
CREATE INDEX "tasks_created_at_idx" ON "tasks"("created_at");

-- CreateIndex
CREATE INDEX "tasks_archived_at_idx" ON "tasks"("archived_at");

-- CreateIndex
CREATE INDEX "task_assignees_person_id_idx" ON "task_assignees"("person_id");

-- CreateIndex
CREATE UNIQUE INDEX "task_assignees_task_id_person_id_key" ON "task_assignees"("task_id", "person_id");

-- CreateIndex
CREATE INDEX "task_status_history_task_id_changed_at_idx" ON "task_status_history"("task_id", "changed_at");

-- CreateIndex
CREATE INDEX "time_entries_task_id_idx" ON "time_entries"("task_id");

-- CreateIndex
CREATE INDEX "time_entries_person_id_business_date_idx" ON "time_entries"("person_id", "business_date");

-- CreateIndex
CREATE INDEX "time_entries_venture_id_business_date_idx" ON "time_entries"("venture_id", "business_date");

-- CreateIndex
CREATE INDEX "time_entries_business_date_idx" ON "time_entries"("business_date");

-- CreateIndex
CREATE INDEX "time_entries_daily_log_id_idx" ON "time_entries"("daily_log_id");

-- CreateIndex
CREATE INDEX "time_entries_created_at_idx" ON "time_entries"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "time_entries_person_id_key" ON "time_entries"("person_id") WHERE ("ended_at" IS NULL);

-- CreateIndex
CREATE INDEX "daily_logs_venture_id_business_date_status_idx" ON "daily_logs"("venture_id", "business_date", "status");

-- CreateIndex
CREATE INDEX "daily_logs_status_idx" ON "daily_logs"("status");

-- CreateIndex
CREATE INDEX "daily_logs_business_date_idx" ON "daily_logs"("business_date");

-- CreateIndex
CREATE UNIQUE INDEX "daily_logs_person_id_venture_id_business_date_key" ON "daily_logs"("person_id", "venture_id", "business_date");

-- CreateIndex
CREATE UNIQUE INDEX "hardware_assets_asset_tag_key" ON "hardware_assets"("asset_tag");

-- CreateIndex
CREATE INDEX "hardware_assets_status_idx" ON "hardware_assets"("status");

-- CreateIndex
CREATE INDEX "asset_assignments_asset_id_idx" ON "asset_assignments"("asset_id");

-- CreateIndex
CREATE INDEX "asset_assignments_person_id_idx" ON "asset_assignments"("person_id");

-- CreateIndex
CREATE INDEX "document_records_person_id_idx" ON "document_records"("person_id");

-- CreateIndex
CREATE INDEX "document_records_status_idx" ON "document_records"("status");

-- CreateIndex
CREATE INDEX "document_records_expiry_date_idx" ON "document_records"("expiry_date");

-- CreateIndex
CREATE INDEX "compensation_agreements_person_id_effective_from_idx" ON "compensation_agreements"("person_id", "effective_from");

-- CreateIndex
CREATE INDEX "payroll_runs_status_idx" ON "payroll_runs"("status");

-- CreateIndex
CREATE INDEX "payroll_runs_period_start_period_end_idx" ON "payroll_runs"("period_start", "period_end");

-- CreateIndex
CREATE INDEX "payroll_lines_person_id_idx" ON "payroll_lines"("person_id");

-- CreateIndex
CREATE INDEX "payroll_lines_payment_status_idx" ON "payroll_lines"("payment_status");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_lines_payroll_run_id_person_id_key" ON "payroll_lines"("payroll_run_id", "person_id");

-- CreateIndex
CREATE INDEX "payroll_adjustments_person_id_idx" ON "payroll_adjustments"("person_id");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_logs_actor_user_id_idx" ON "audit_logs"("actor_user_id");

-- CreateIndex
CREATE INDEX "audit_logs_action_idx" ON "audit_logs"("action");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "people" ADD CONSTRAINT "people_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "venture_memberships" ADD CONSTRAINT "venture_memberships_venture_id_fkey" FOREIGN KEY ("venture_id") REFERENCES "ventures"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "venture_memberships" ADD CONSTRAINT "venture_memberships_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_venture_id_fkey" FOREIGN KEY ("venture_id") REFERENCES "ventures"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_assignees" ADD CONSTRAINT "task_assignees_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_assignees" ADD CONSTRAINT "task_assignees_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_status_history" ADD CONSTRAINT "task_status_history_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_venture_id_fkey" FOREIGN KEY ("venture_id") REFERENCES "ventures"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_daily_log_id_fkey" FOREIGN KEY ("daily_log_id") REFERENCES "daily_logs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_logs" ADD CONSTRAINT "daily_logs_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_logs" ADD CONSTRAINT "daily_logs_venture_id_fkey" FOREIGN KEY ("venture_id") REFERENCES "ventures"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_assignments" ADD CONSTRAINT "asset_assignments_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "hardware_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_assignments" ADD CONSTRAINT "asset_assignments_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_records" ADD CONSTRAINT "document_records_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compensation_agreements" ADD CONSTRAINT "compensation_agreements_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_lines" ADD CONSTRAINT "payroll_lines_payroll_run_id_fkey" FOREIGN KEY ("payroll_run_id") REFERENCES "payroll_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_lines" ADD CONSTRAINT "payroll_lines_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_adjustments" ADD CONSTRAINT "payroll_adjustments_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_adjustments" ADD CONSTRAINT "payroll_adjustments_source_payroll_line_id_fkey" FOREIGN KEY ("source_payroll_line_id") REFERENCES "payroll_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_adjustments" ADD CONSTRAINT "payroll_adjustments_settled_payroll_line_id_fkey" FOREIGN KEY ("settled_payroll_line_id") REFERENCES "payroll_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
