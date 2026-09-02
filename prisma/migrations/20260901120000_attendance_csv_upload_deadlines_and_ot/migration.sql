-- AlterEnum
-- Postgres only allows one ADD VALUE per ALTER TYPE statement.
ALTER TYPE "ManualAttendanceStatus" ADD VALUE 'WEEK_OFF';
ALTER TYPE "ManualAttendanceStatus" ADD VALUE 'HOLIDAY';

-- CreateEnum
CREATE TYPE "AttendanceEntrySource" AS ENUM ('MANUAL_DAILY_EDIT', 'MANUAL_CSV');

-- CreateEnum
CREATE TYPE "DeadlineScope" AS ENUM ('CLIENT', 'STORE');

-- CreateEnum
CREATE TYPE "PeriodStatus" AS ENUM ('OPEN', 'CLOSED', 'MISSED', 'LATE_REQUESTED', 'LATE_GRANTED', 'LATE_DENIED', 'CLOSED_LATE');

-- CreateEnum
CREATE TYPE "LateRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'DENIED');

-- CreateEnum
CREATE TYPE "BatchStatus" AS ENUM ('VALIDATING', 'VALIDATED_PENDING_COMMIT', 'COMMITTED', 'FAILED');

-- CreateEnum
CREATE TYPE "OvertimeSource" AS ENUM ('DAILY_SUM', 'MANUAL_TOTAL');

-- CreateTable
CREATE TABLE "AttendanceDeadlinePolicy" (
    "id" TEXT NOT NULL,
    "scope" "DeadlineScope" NOT NULL,
    "clientId" TEXT,
    "storeId" TEXT,
    "deadlineDay" INTEGER NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AttendanceDeadlinePolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendancePeriod" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "periodYear" INTEGER NOT NULL,
    "periodMonth" INTEGER NOT NULL,
    "deadlineAt" TIMESTAMP(3) NOT NULL,
    "status" "PeriodStatus" NOT NULL DEFAULT 'OPEN',
    "submittedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "isLate" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AttendancePeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LateUploadRequest" (
    "id" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "requestedByUserId" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT,
    "status" "LateRequestStatus" NOT NULL DEFAULT 'PENDING',
    "resolvedByUserId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "grantedUntil" TIMESTAMP(3),
    "adminNote" TEXT,

    CONSTRAINT "LateUploadRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceUploadBatch" (
    "id" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "uploadedByUserId" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fileName" TEXT NOT NULL,
    "otMode" "OvertimeSource" NOT NULL,
    "status" "BatchStatus" NOT NULL DEFAULT 'VALIDATING',
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "warningCount" INTEGER NOT NULL DEFAULT 0,
    "isLate" BOOLEAN NOT NULL DEFAULT false,
    "parsedSnapshot" JSONB,
    "errorReport" JSONB,

    CONSTRAINT "AttendanceUploadBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeMonthlyOvertime" (
    "id" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "totalHours" DECIMAL(6,2) NOT NULL,
    "source" "OvertimeSource" NOT NULL,
    "hasDiscrepancy" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeeMonthlyOvertime_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "ManualAttendanceEntry" ADD COLUMN     "otHours" DECIMAL(5,2),
ADD COLUMN     "source" "AttendanceEntrySource" NOT NULL DEFAULT 'MANUAL_DAILY_EDIT',
ADD COLUMN     "uploadBatchId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceDeadlinePolicy_clientId_key" ON "AttendanceDeadlinePolicy"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceDeadlinePolicy_storeId_key" ON "AttendanceDeadlinePolicy"("storeId");

-- CreateIndex
CREATE INDEX "AttendancePeriod_status_idx" ON "AttendancePeriod"("status");

-- CreateIndex
CREATE UNIQUE INDEX "AttendancePeriod_storeId_periodYear_periodMonth_key" ON "AttendancePeriod"("storeId", "periodYear", "periodMonth");

-- CreateIndex
CREATE INDEX "LateUploadRequest_periodId_status_idx" ON "LateUploadRequest"("periodId", "status");

-- CreateIndex
CREATE INDEX "AttendanceUploadBatch_periodId_status_idx" ON "AttendanceUploadBatch"("periodId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "EmployeeMonthlyOvertime_periodId_employeeId_key" ON "EmployeeMonthlyOvertime"("periodId", "employeeId");

-- CreateIndex
CREATE INDEX "ManualAttendanceEntry_uploadBatchId_idx" ON "ManualAttendanceEntry"("uploadBatchId");

-- AddForeignKey
ALTER TABLE "AttendanceDeadlinePolicy" ADD CONSTRAINT "AttendanceDeadlinePolicy_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceDeadlinePolicy" ADD CONSTRAINT "AttendanceDeadlinePolicy_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendancePeriod" ADD CONSTRAINT "AttendancePeriod_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LateUploadRequest" ADD CONSTRAINT "LateUploadRequest_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "AttendancePeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LateUploadRequest" ADD CONSTRAINT "LateUploadRequest_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LateUploadRequest" ADD CONSTRAINT "LateUploadRequest_resolvedByUserId_fkey" FOREIGN KEY ("resolvedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceUploadBatch" ADD CONSTRAINT "AttendanceUploadBatch_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "AttendancePeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceUploadBatch" ADD CONSTRAINT "AttendanceUploadBatch_uploadedByUserId_fkey" FOREIGN KEY ("uploadedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeMonthlyOvertime" ADD CONSTRAINT "EmployeeMonthlyOvertime_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "AttendancePeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeMonthlyOvertime" ADD CONSTRAINT "EmployeeMonthlyOvertime_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManualAttendanceEntry" ADD CONSTRAINT "ManualAttendanceEntry_uploadBatchId_fkey" FOREIGN KEY ("uploadBatchId") REFERENCES "AttendanceUploadBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
