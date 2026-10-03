-- Salary engine: payroll identity fields, per-client config, salary slabs, assignments, runs.
ALTER TABLE "Employee" ADD COLUMN "fatherName" TEXT;
ALTER TABLE "Employee" ADD COLUMN "uan" TEXT;
ALTER TABLE "Employee" ADD COLUMN "esicNumber" TEXT;

CREATE TYPE "PayrollRunStatus" AS ENUM ('DRAFT', 'FINALIZED');

CREATE TABLE "ClientPayrollConfig" (
    "clientId" TEXT NOT NULL,
    "pfEmployeePct" DOUBLE PRECISION NOT NULL DEFAULT 12,
    "pfEmployerPct" DOUBLE PRECISION NOT NULL DEFAULT 12,
    "pfAdminPct" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "pfWageCeiling" INTEGER DEFAULT 15000,
    "esicEmployeePct" DOUBLE PRECISION NOT NULL DEFAULT 0.75,
    "esicEmployerPct" DOUBLE PRECISION NOT NULL DEFAULT 3.25,
    "esicGrossLimit" INTEGER NOT NULL DEFAULT 21000,
    "esicBase" TEXT NOT NULL DEFAULT 'BASIC',
    "insurance" INTEGER NOT NULL DEFAULT 0,
    "pt" INTEGER NOT NULL DEFAULT 0,
    "lwf" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ClientPayrollConfig_pkey" PRIMARY KEY ("clientId")
);

CREATE TABLE "SalarySlab" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "designation" "Designation" NOT NULL,
    "name" TEXT NOT NULL,
    "basic" INTEGER NOT NULL,
    "hra" INTEGER NOT NULL,
    "specialAllowance" INTEGER NOT NULL DEFAULT 0,
    "travellingAllowance" INTEGER NOT NULL DEFAULT 0,
    "otDayRate" INTEGER,
    "otHourRate" INTEGER,
    "bonusDayRate" INTEGER,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SalarySlab_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SalarySlab_clientId_designation_name_key" ON "SalarySlab"("clientId", "designation", "name");
CREATE INDEX "SalarySlab_clientId_designation_idx" ON "SalarySlab"("clientId", "designation");

CREATE TABLE "EmployeeSalaryAssignment" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "slabId" TEXT NOT NULL,
    "assignedByUserId" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EmployeeSalaryAssignment_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "EmployeeSalaryAssignment_employeeId_key" ON "EmployeeSalaryAssignment"("employeeId");

CREATE TABLE "PayrollRun" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "periodYear" INTEGER NOT NULL,
    "periodMonth" INTEGER NOT NULL,
    "status" "PayrollRunStatus" NOT NULL DEFAULT 'DRAFT',
    "configSnapshot" JSONB NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finalizedByUserId" TEXT,
    "finalizedAt" TIMESTAMP(3),
    CONSTRAINT "PayrollRun_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PayrollRun_clientId_periodYear_periodMonth_key" ON "PayrollRun"("clientId", "periodYear", "periodMonth");

CREATE TABLE "PayrollLine" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "identity" JSONB NOT NULL,
    "inputs" JSONB NOT NULL,
    "result" JSONB,
    "warnings" TEXT[],
    "gross" INTEGER NOT NULL DEFAULT 0,
    "netTakeHome" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "PayrollLine_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PayrollLine_runId_employeeId_key" ON "PayrollLine"("runId", "employeeId");

ALTER TABLE "ClientPayrollConfig" ADD CONSTRAINT "ClientPayrollConfig_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SalarySlab" ADD CONSTRAINT "SalarySlab_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EmployeeSalaryAssignment" ADD CONSTRAINT "EmployeeSalaryAssignment_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EmployeeSalaryAssignment" ADD CONSTRAINT "EmployeeSalaryAssignment_slabId_fkey" FOREIGN KEY ("slabId") REFERENCES "SalarySlab"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PayrollRun" ADD CONSTRAINT "PayrollRun_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PayrollLine" ADD CONSTRAINT "PayrollLine_runId_fkey" FOREIGN KEY ("runId") REFERENCES "PayrollRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PayrollLine" ADD CONSTRAINT "PayrollLine_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
