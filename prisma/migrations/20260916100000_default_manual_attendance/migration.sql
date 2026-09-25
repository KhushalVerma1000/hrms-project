-- AlterTable
-- Only changes the default applied to NEW rows going forward — existing
-- Store rows keep whatever attendanceMode they already have (e.g. the
-- seeded Saket/BIOMETRIC demo store is untouched). The product should work
-- fully standalone (MANUAL) unless a store deliberately opts into
-- biometric; see the paired change in stores/actions.ts.
ALTER TABLE "Store" ALTER COLUMN "attendanceMode" SET DEFAULT 'MANUAL';
