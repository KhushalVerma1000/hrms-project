-- Bank details for bulk NEFT payout sheets.
ALTER TABLE "Employee" ADD COLUMN "bankAccountNumber" TEXT;
ALTER TABLE "Employee" ADD COLUMN "ifscCode" TEXT;
