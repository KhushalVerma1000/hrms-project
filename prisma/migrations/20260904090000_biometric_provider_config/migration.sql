-- CreateEnum
CREATE TYPE "BiometricProviderType" AS ENUM ('SMARTOFFICE', 'MANUAL');

-- CreateTable
CREATE TABLE "BiometricProviderConfig" (
    "id" TEXT NOT NULL,
    "type" "BiometricProviderType" NOT NULL,
    "label" TEXT NOT NULL,
    "baseUrl" TEXT,
    "apiKeyEnv" TEXT,
    "timezone" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BiometricProviderConfig_pkey" PRIMARY KEY ("id")
);

-- AlterTable
-- Added nullable first so it can be backfilled below before being made
-- required — every existing Device row must end up pointing at a provider.
ALTER TABLE "Device" ADD COLUMN "providerId" TEXT;

-- Data migration
-- Backfill a single default SmartOffice provider config, pointed at the
-- existing SMARTOFFICE_BASE_URL / SMARTOFFICE_API_KEY env vars (via the
-- apiKeyEnv pointer, not the secret itself). Every current Device is wired
-- to it, matching today's behavior with no manual per-store work.
INSERT INTO "BiometricProviderConfig" ("id", "type", "label", "apiKeyEnv", "isDefault", "createdAt")
VALUES ('default-smartoffice-provider', 'SMARTOFFICE', 'SmartOffice — Primary', 'SMARTOFFICE_API_KEY', true, CURRENT_TIMESTAMP);

UPDATE "Device" SET "providerId" = 'default-smartoffice-provider' WHERE "providerId" IS NULL;

-- AlterTable
ALTER TABLE "Device" ALTER COLUMN "providerId" SET NOT NULL;

-- CreateIndex
CREATE INDEX "Device_providerId_idx" ON "Device"("providerId");

-- AddForeignKey
ALTER TABLE "Device" ADD CONSTRAINT "Device_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "BiometricProviderConfig"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
