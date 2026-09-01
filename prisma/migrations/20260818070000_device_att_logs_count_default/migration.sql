-- Backfill existing NULLs, then make attLogsCount NOT NULL with a default of 0.
-- Without this, Device.attLogsCount could never increment past NULL: Postgres
-- evaluates `NULL + n` as NULL, so the running device-log counter silently
-- stayed empty forever (see src/lib/sync/attendance.ts).
UPDATE "Device" SET "attLogsCount" = 0 WHERE "attLogsCount" IS NULL;
ALTER TABLE "Device" ALTER COLUMN "attLogsCount" SET DEFAULT 0;
ALTER TABLE "Device" ALTER COLUMN "attLogsCount" SET NOT NULL;
