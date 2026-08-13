-- CreateEnum
CREATE TYPE "AttendanceMode" AS ENUM ('BIOMETRIC', 'MANUAL');

-- CreateEnum
CREATE TYPE "ManualAttendanceStatus" AS ENUM ('PRESENT', 'ABSENT', 'HALF_DAY', 'ON_LEAVE');

-- AlterEnum
ALTER TYPE "Designation" ADD VALUE 'HOUSEKEEPING';

-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "googleFormBaseUrl" TEXT,
ADD COLUMN     "googleFormECodeFieldId" TEXT;

-- AlterTable
ALTER TABLE "Store" ADD COLUMN     "attendanceMode" "AttendanceMode" NOT NULL DEFAULT 'BIOMETRIC';

-- CreateTable
CREATE TABLE "ManualAttendanceEntry" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "status" "ManualAttendanceStatus" NOT NULL,
    "checkInTime" TIMESTAMP(3),
    "checkOutTime" TIMESTAMP(3),
    "notes" TEXT,
    "employeeId" TEXT NOT NULL,
    "enteredByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ManualAttendanceEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ManualAttendanceEntry_employeeId_date_idx" ON "ManualAttendanceEntry"("employeeId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "ManualAttendanceEntry_employeeId_date_key" ON "ManualAttendanceEntry"("employeeId", "date");

-- AddForeignKey
ALTER TABLE "ManualAttendanceEntry" ADD CONSTRAINT "ManualAttendanceEntry_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManualAttendanceEntry" ADD CONSTRAINT "ManualAttendanceEntry_enteredByUserId_fkey" FOREIGN KEY ("enteredByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
