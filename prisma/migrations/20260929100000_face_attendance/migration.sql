-- Face-scan attendance: new entry source + enrolment templates.
-- Postgres only allows one ADD VALUE per ALTER TYPE statement.
ALTER TYPE "AttendanceEntrySource" ADD VALUE 'FACE_SCAN';

CREATE TABLE "FaceTemplate" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "descriptor" DOUBLE PRECISION[],
    "consentAt" TIMESTAMP(3) NOT NULL,
    "enrolledByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FaceTemplate_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FaceTemplate_employeeId_idx" ON "FaceTemplate"("employeeId");

ALTER TABLE "FaceTemplate" ADD CONSTRAINT "FaceTemplate_employeeId_fkey"
  FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
