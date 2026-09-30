-- AlterTable
ALTER TABLE "OutboxEvent" ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "OutboxEvent" ADD COLUMN "failedAt" TIMESTAMPTZ(3);
ALTER TABLE "OutboxEvent" ADD COLUMN "lastError" TEXT;

-- AlterTable
ALTER TABLE "JobRun" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'running';
ALTER TABLE "JobRun" ADD COLUMN "completedAt" TIMESTAMPTZ(3);
