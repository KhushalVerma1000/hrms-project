-- Store-level onboarding Google Form override. NULL = inherit the Client's form.
ALTER TABLE "Store" ADD COLUMN "googleFormBaseUrl" TEXT;
ALTER TABLE "Store" ADD COLUMN "googleFormECodeFieldId" TEXT;
