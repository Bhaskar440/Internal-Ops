-- CreateEnum
CREATE TYPE "NotificationKind" AS ENUM ('TASK_ASSIGNED', 'TASK_DUE_SOON', 'TASK_OVERDUE', 'DAILY_LOG_MISSING', 'DAILY_LOG_REJECTED', 'DOCUMENT_EXPIRING', 'ACCOUNT_AWAITING_APPROVAL', 'PAYROLL_EXCEPTION');

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "person_id" TEXT NOT NULL,
    "kind" "NotificationKind" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "link" TEXT,
    "dedupe_key" TEXT NOT NULL,
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notifications_person_id_read_at_idx" ON "notifications"("person_id", "read_at");

-- CreateIndex
CREATE INDEX "notifications_created_at_idx" ON "notifications"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_person_id_dedupe_key_key" ON "notifications"("person_id", "dedupe_key");

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id") ON DELETE CASCADE ON UPDATE CASCADE;
