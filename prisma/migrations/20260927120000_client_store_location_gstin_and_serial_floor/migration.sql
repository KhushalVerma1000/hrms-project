-- AlterTable: new display fields, both nullable — no backfill needed.
ALTER TABLE "Client" ADD COLUMN "location" TEXT;
ALTER TABLE "Client" ADD COLUMN "gstin" TEXT;

ALTER TABLE "Store" ADD COLUMN "location" TEXT;
ALTER TABLE "Store" ADD COLUMN "gstin" TEXT;

-- E-code leading-zero audit fix (see src/lib/ecode.ts):
-- nextEmployeeSerial now defaults to 100 so a store's first-ever employee
-- gets Serial "100" instead of "001" — consistent with the Client/
-- WarehouseType/Store 2-digit segments, which already start at "10" for
-- the same reason (leading zeros get silently stripped if the e-code is
-- ever opened in Excel/Sheets or treated as a number downstream).
ALTER TABLE "Store" ALTER COLUMN "nextEmployeeSerial" SET DEFAULT 100;

-- Only bump EXISTING stores that are still sitting at the untouched
-- default of 1 — i.e. stores that haven't onboarded anyone yet. A store
-- that has already issued serials (2, 3, 4, ...) is left alone: those
-- employee codes are already live (printed on ID cards, synced to
-- SmartOffice, matched against biometric devices) and must not be
-- renumbered retroactively. This only closes the gap for stores that
-- haven't started yet.
UPDATE "Store" SET "nextEmployeeSerial" = 100 WHERE "nextEmployeeSerial" = 1;
