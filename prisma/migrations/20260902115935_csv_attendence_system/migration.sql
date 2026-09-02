-- DropForeignKey
ALTER TABLE "AttendanceDeadlinePolicy" DROP CONSTRAINT "AttendanceDeadlinePolicy_clientId_fkey";

-- DropForeignKey
ALTER TABLE "AttendanceDeadlinePolicy" DROP CONSTRAINT "AttendanceDeadlinePolicy_storeId_fkey";

-- DropForeignKey
ALTER TABLE "LateUploadRequest" DROP CONSTRAINT "LateUploadRequest_resolvedByUserId_fkey";

-- AddForeignKey
ALTER TABLE "AttendanceDeadlinePolicy" ADD CONSTRAINT "AttendanceDeadlinePolicy_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceDeadlinePolicy" ADD CONSTRAINT "AttendanceDeadlinePolicy_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LateUploadRequest" ADD CONSTRAINT "LateUploadRequest_resolvedByUserId_fkey" FOREIGN KEY ("resolvedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
