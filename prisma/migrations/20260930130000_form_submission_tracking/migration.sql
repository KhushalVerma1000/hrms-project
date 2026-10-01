-- Track how a form became SUBMITTED, and let admins resolve unmatched submissions.
ALTER TABLE "Employee" ADD COLUMN "onboardingFormSubmittedVia" TEXT;
ALTER TABLE "UnmatchedFormSubmission" ADD COLUMN "formId" TEXT;
ALTER TABLE "UnmatchedFormSubmission" ADD COLUMN "resolution" TEXT;
ALTER TABLE "UnmatchedFormSubmission" ADD COLUMN "resolvedEmployeeId" TEXT;
CREATE INDEX "UnmatchedFormSubmission_resolvedAt_createdAt_idx" ON "UnmatchedFormSubmission"("resolvedAt", "createdAt");
