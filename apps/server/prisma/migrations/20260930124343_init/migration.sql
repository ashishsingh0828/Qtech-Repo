-- CreateEnum
CREATE TYPE "Role" AS ENUM ('admin', 'manager', 'validator', 'service');

-- CreateEnum
CREATE TYPE "CallType" AS ENUM ('Complaint', 'Breakdown', 'Emergency', 'CourtesyVisit');

-- CreateEnum
CREATE TYPE "CallStatus" AS ENUM ('Open', 'Resolved');

-- CreateEnum
CREATE TYPE "Priority" AS ENUM ('normal', 'high');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMPTZ(3),
    "lastSeenAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Dataset" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sourceFileName" TEXT NOT NULL,
    "schema" JSONB NOT NULL,
    "rowCount" INTEGER NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),
    "deletedById" TEXT,

    CONSTRAINT "Dataset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Row" (
    "id" TEXT NOT NULL,
    "datasetId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "data" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "validated" TEXT,
    "validationDue" DATE,
    "verified" TEXT,
    "endDate" DATE,
    "amcStatus" TEXT,
    "nextFollowUp" DATE,
    "nextDuePms" DATE,
    "assignedValidatorId" TEXT,
    "assignedServiceId" TEXT,
    "updatedById" TEXT,
    "updatedByName" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),
    "deletedById" TEXT,

    CONSTRAINT "Row_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoleGroupAccess" (
    "id" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "groupKey" TEXT NOT NULL,
    "canView" BOOLEAN NOT NULL,
    "canEdit" BOOLEAN NOT NULL,

    CONSTRAINT "RoleGroupAccess_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityLog" (
    "id" TEXT NOT NULL,
    "datasetId" TEXT,
    "rowId" TEXT,
    "actorId" TEXT,
    "actorName" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actionId" TEXT,
    "columnKey" TEXT,
    "groupKey" TEXT,
    "fromValue" JSONB,
    "toValue" JSONB,
    "meta" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivityLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceCall" (
    "id" TEXT NOT NULL,
    "datasetId" TEXT NOT NULL,
    "rowId" TEXT NOT NULL,
    "type" "CallType" NOT NULL,
    "description" TEXT NOT NULL,
    "reportedAt" TIMESTAMPTZ(3) NOT NULL,
    "status" "CallStatus" NOT NULL DEFAULT 'Open',
    "resolvedAt" TIMESTAMPTZ(3),
    "resolvedById" TEXT,
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "ServiceCall_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "priority" "Priority" NOT NULL DEFAULT 'normal',
    "datasetId" TEXT,
    "rowId" TEXT,
    "actorId" TEXT,
    "actorName" TEXT NOT NULL,
    "customerName" TEXT,
    "params" JSONB NOT NULL,
    "readAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutboxEvent" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "actorId" TEXT,
    "actionId" TEXT,
    "runAt" TIMESTAMPTZ(3) NOT NULL,
    "processedAt" TIMESTAMPTZ(3),
    "cancelledAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutboxEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobRun" (
    "id" TEXT NOT NULL,
    "jobName" TEXT NOT NULL,
    "runDate" DATE NOT NULL,
    "scope" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Row_datasetId_position_idx" ON "Row"("datasetId", "position");

-- CreateIndex
CREATE INDEX "Row_datasetId_deletedAt_idx" ON "Row"("datasetId", "deletedAt");

-- CreateIndex
CREATE INDEX "Row_datasetId_validated_idx" ON "Row"("datasetId", "validated");

-- CreateIndex
CREATE INDEX "Row_datasetId_validationDue_idx" ON "Row"("datasetId", "validationDue");

-- CreateIndex
CREATE INDEX "Row_datasetId_verified_idx" ON "Row"("datasetId", "verified");

-- CreateIndex
CREATE INDEX "Row_datasetId_endDate_idx" ON "Row"("datasetId", "endDate");

-- CreateIndex
CREATE INDEX "Row_datasetId_amcStatus_idx" ON "Row"("datasetId", "amcStatus");

-- CreateIndex
CREATE INDEX "Row_datasetId_nextFollowUp_idx" ON "Row"("datasetId", "nextFollowUp");

-- CreateIndex
CREATE INDEX "Row_datasetId_nextDuePms_idx" ON "Row"("datasetId", "nextDuePms");

-- CreateIndex
CREATE INDEX "Row_assignedValidatorId_idx" ON "Row"("assignedValidatorId");

-- CreateIndex
CREATE INDEX "Row_assignedServiceId_idx" ON "Row"("assignedServiceId");

-- CreateIndex
CREATE INDEX "Row_datasetId_updatedAt_idx" ON "Row"("datasetId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "RoleGroupAccess_role_groupKey_key" ON "RoleGroupAccess"("role", "groupKey");

-- CreateIndex
CREATE INDEX "ActivityLog_datasetId_rowId_createdAt_idx" ON "ActivityLog"("datasetId", "rowId", "createdAt");

-- CreateIndex
CREATE INDEX "ActivityLog_datasetId_createdAt_idx" ON "ActivityLog"("datasetId", "createdAt");

-- CreateIndex
CREATE INDEX "ActivityLog_actionId_idx" ON "ActivityLog"("actionId");

-- CreateIndex
CREATE INDEX "ServiceCall_datasetId_rowId_idx" ON "ServiceCall"("datasetId", "rowId");

-- CreateIndex
CREATE INDEX "ServiceCall_status_idx" ON "ServiceCall"("status");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_createdAt_idx" ON "Notification"("userId", "readAt", "createdAt");

-- CreateIndex
CREATE INDEX "OutboxEvent_processedAt_cancelledAt_runAt_idx" ON "OutboxEvent"("processedAt", "cancelledAt", "runAt");

-- CreateIndex
CREATE UNIQUE INDEX "JobRun_jobName_runDate_scope_key" ON "JobRun"("jobName", "runDate", "scope");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dataset" ADD CONSTRAINT "Dataset_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Row" ADD CONSTRAINT "Row_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "Dataset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
