-- CreateEnum
CREATE TYPE "HrEmployeeType" AS ENUM ('staff', 'rider', 'manager', 'hr', 'admin');

-- CreateEnum
CREATE TYPE "HrEmployeeStatus" AS ENUM ('active', 'on_leave', 'notice', 'exited');

-- CreateEnum
CREATE TYPE "HrDocumentType" AS ENUM ('id_proof', 'address_proof', 'contract', 'certificate', 'medical', 'other');

-- CreateEnum
CREATE TYPE "HrOnboardingCategory" AS ENUM ('documents', 'equipment', 'access', 'training', 'induction');

-- CreateEnum
CREATE TYPE "HrOnboardingStatus" AS ENUM ('pending', 'given', 'shown', 'done');

-- CreateEnum
CREATE TYPE "HrHistoryField" AS ENUM ('designation', 'role', 'employee_type', 'store', 'pay_grade', 'reporting_to', 'status');

-- CreateEnum
CREATE TYPE "HrAttendanceStatus" AS ENUM ('present', 'late', 'absent', 'on_leave', 'off');

-- CreateEnum
CREATE TYPE "HrLeaveType" AS ENUM ('casual', 'sick', 'earned', 'unpaid', 'other');

-- CreateEnum
CREATE TYPE "HrLeaveStatus" AS ENUM ('pending', 'approved', 'rejected', 'withdrawn');

-- CreateEnum
CREATE TYPE "HrLeaveLedgerKind" AS ENUM ('grant', 'debit');

-- CreateEnum
CREATE TYPE "HrHolidayType" AS ENUM ('public', 'company', 'store');

-- CreateTable
CREATE TABLE "commerce_hr_employees" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "employeeType" "HrEmployeeType" NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "storeId" UUID,
    "role" TEXT NOT NULL,
    "designation" TEXT,
    "payGrade" TEXT,
    "joinDate" DATE NOT NULL,
    "dateOfBirth" DATE,
    "address" TEXT,
    "emergencyName" TEXT,
    "emergencyPhone" TEXT,
    "emergencyRelation" TEXT,
    "bankHolderName" TEXT,
    "bankAccountLast4" TEXT,
    "bankAccountEnc" TEXT,
    "bankIfsc" TEXT,
    "gatewayUserId" UUID,
    "reportingTo" UUID,
    "status" "HrEmployeeStatus" NOT NULL DEFAULT 'active',
    "lastWorkingDay" DATE,
    "exitReason" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "commerce_hr_employees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce_hr_employee_documents" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "type" "HrDocumentType" NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "mimeType" TEXT,
    "sizeBytes" INTEGER,
    "uploadedByUserId" TEXT,
    "uploadedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commerce_hr_employee_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce_hr_onboarding_template_items" (
    "id" UUID NOT NULL,
    "role" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "category" "HrOnboardingCategory" NOT NULL DEFAULT 'induction',

    CONSTRAINT "commerce_hr_onboarding_template_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce_hr_onboarding_items" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "category" "HrOnboardingCategory" NOT NULL,
    "status" "HrOnboardingStatus" NOT NULL DEFAULT 'pending',
    "note" TEXT,
    "doneAt" TIMESTAMPTZ(6),
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "commerce_hr_onboarding_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce_hr_employee_history" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "field" "HrHistoryField" NOT NULL,
    "fromValue" TEXT,
    "toValue" TEXT,
    "effectiveDate" DATE NOT NULL,
    "reason" TEXT,
    "changedByUserId" TEXT,
    "changedByName" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commerce_hr_employee_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce_hr_attendance" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "storeId" UUID,
    "date" DATE NOT NULL,
    "status" "HrAttendanceStatus" NOT NULL,
    "clockIn" TIMESTAMPTZ(6),
    "clockOut" TIMESTAMPTZ(6),
    "corrected" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "commerce_hr_attendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce_hr_attendance_corrections" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "storeId" UUID,
    "date" DATE NOT NULL,
    "previousClockIn" TIMESTAMPTZ(6),
    "previousClockOut" TIMESTAMPTZ(6),
    "newClockIn" TIMESTAMPTZ(6),
    "newClockOut" TIMESTAMPTZ(6),
    "reason" TEXT NOT NULL,
    "correctedByUserId" TEXT,
    "correctedByName" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commerce_hr_attendance_corrections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce_hr_rosters" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "shiftStartMin" INTEGER NOT NULL,
    "shiftEndMin" INTEGER NOT NULL,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commerce_hr_rosters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce_hr_leave_policies" (
    "id" UUID NOT NULL,
    "type" "HrLeaveType" NOT NULL,
    "annualHalfDays" INTEGER NOT NULL,
    "carryForward" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "commerce_hr_leave_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce_hr_leave_balances" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "type" "HrLeaveType" NOT NULL,
    "year" INTEGER NOT NULL,
    "entitledHalfDays" INTEGER NOT NULL,
    "takenHalfDays" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "commerce_hr_leave_balances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce_hr_leave_ledger" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "type" "HrLeaveType" NOT NULL,
    "year" INTEGER NOT NULL,
    "kind" "HrLeaveLedgerKind" NOT NULL,
    "deltaHalfDays" INTEGER NOT NULL,
    "requestId" UUID,
    "note" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commerce_hr_leave_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce_hr_leave_requests" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "type" "HrLeaveType" NOT NULL,
    "fromDate" DATE NOT NULL,
    "toDate" DATE NOT NULL,
    "halfDay" BOOLEAN NOT NULL DEFAULT false,
    "chargeableHalfDays" INTEGER NOT NULL,
    "status" "HrLeaveStatus" NOT NULL DEFAULT 'pending',
    "reason" TEXT,
    "decidedByUserId" TEXT,
    "decidedByName" TEXT,
    "decidedAt" TIMESTAMPTZ(6),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "commerce_hr_leave_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce_hr_holidays" (
    "id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "name" TEXT NOT NULL,
    "type" "HrHolidayType" NOT NULL DEFAULT 'public',
    "storeIds" UUID[],
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commerce_hr_holidays_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce_hr_daily_reports" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "storeId" UUID,
    "date" DATE NOT NULL,
    "summary" TEXT NOT NULL,
    "completed" TEXT[],
    "blockers" TEXT,
    "blockerKey" TEXT,
    "minutesWorked" INTEGER,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commerce_hr_daily_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce_hr_work_reassignments" (
    "id" UUID NOT NULL,
    "fromEmployeeId" UUID NOT NULL,
    "toEmployeeId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "workItemIds" UUID[],
    "byUserId" TEXT,
    "byName" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commerce_hr_work_reassignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce_hr_career_plans" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "targetRole" TEXT,
    "goals" JSONB NOT NULL,
    "skillGaps" TEXT[],
    "agreedActions" JSONB NOT NULL,
    "lastReviewedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "commerce_hr_career_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce_hr_career_reviews" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "note" TEXT NOT NULL,
    "reviewedByUserId" TEXT,
    "reviewedByName" TEXT NOT NULL,
    "reviewedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commerce_hr_career_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce_hr_career_paths" (
    "id" UUID NOT NULL,
    "role" TEXT NOT NULL,
    "nextRoles" TEXT[],
    "requirements" TEXT[],
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "commerce_hr_career_paths_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "commerce_hr_employees_code_key" ON "commerce_hr_employees"("code");

-- CreateIndex
CREATE UNIQUE INDEX "commerce_hr_employees_phone_key" ON "commerce_hr_employees"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "commerce_hr_employees_gatewayUserId_key" ON "commerce_hr_employees"("gatewayUserId");

-- CreateIndex
CREATE INDEX "idx_hr_employee_store_name" ON "commerce_hr_employees"("storeId", "name");

-- CreateIndex
CREATE INDEX "idx_hr_employee_status_name" ON "commerce_hr_employees"("status", "name");

-- CreateIndex
CREATE INDEX "idx_hr_employee_type_status" ON "commerce_hr_employees"("employeeType", "status");

-- CreateIndex
CREATE INDEX "idx_hr_employee_reporting_to" ON "commerce_hr_employees"("reportingTo");

-- CreateIndex
CREATE INDEX "idx_hr_doc_employee_uploaded" ON "commerce_hr_employee_documents"("employeeId", "uploadedAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "uq_hr_onboarding_template_position" ON "commerce_hr_onboarding_template_items"("role", "position");

-- CreateIndex
CREATE INDEX "idx_hr_onboarding_item_employee" ON "commerce_hr_onboarding_items"("employeeId", "position");

-- CreateIndex
CREATE INDEX "idx_hr_history_employee_created" ON "commerce_hr_employee_history"("employeeId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "idx_hr_attendance_store_date" ON "commerce_hr_attendance"("storeId", "date");

-- CreateIndex
CREATE INDEX "idx_hr_attendance_date" ON "commerce_hr_attendance"("date");

-- CreateIndex
CREATE UNIQUE INDEX "uq_hr_attendance_employee_date" ON "commerce_hr_attendance"("employeeId", "date");

-- CreateIndex
CREATE INDEX "idx_hr_correction_employee_date" ON "commerce_hr_attendance_corrections"("employeeId", "date" DESC);

-- CreateIndex
CREATE INDEX "idx_hr_correction_store_date" ON "commerce_hr_attendance_corrections"("storeId", "date" DESC);

-- CreateIndex
CREATE INDEX "idx_hr_correction_date" ON "commerce_hr_attendance_corrections"("date" DESC);

-- CreateIndex
CREATE INDEX "idx_hr_roster_store_date" ON "commerce_hr_rosters"("storeId", "date");

-- CreateIndex
CREATE INDEX "idx_hr_roster_employee_date" ON "commerce_hr_rosters"("employeeId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "uq_hr_roster_employee_shift" ON "commerce_hr_rosters"("employeeId", "date", "shiftStartMin");

-- CreateIndex
CREATE UNIQUE INDEX "commerce_hr_leave_policies_type_key" ON "commerce_hr_leave_policies"("type");

-- CreateIndex
CREATE UNIQUE INDEX "uq_hr_leave_balance" ON "commerce_hr_leave_balances"("employeeId", "type", "year");

-- CreateIndex
CREATE INDEX "idx_hr_leave_ledger_employee" ON "commerce_hr_leave_ledger"("employeeId", "type", "year");

-- CreateIndex
CREATE UNIQUE INDEX "uq_hr_leave_ledger_request" ON "commerce_hr_leave_ledger"("requestId", "year", "kind");

-- CreateIndex
CREATE INDEX "idx_hr_leave_status_created" ON "commerce_hr_leave_requests"("status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "idx_hr_leave_employee_from" ON "commerce_hr_leave_requests"("employeeId", "fromDate");

-- CreateIndex
CREATE INDEX "idx_hr_leave_status_range" ON "commerce_hr_leave_requests"("status", "fromDate", "toDate");

-- CreateIndex
CREATE INDEX "idx_hr_holiday_date" ON "commerce_hr_holidays"("date");

-- CreateIndex
CREATE UNIQUE INDEX "uq_hr_holiday_date_name" ON "commerce_hr_holidays"("date", "name");

-- CreateIndex
CREATE INDEX "idx_hr_daily_report_store_date" ON "commerce_hr_daily_reports"("storeId", "date" DESC);

-- CreateIndex
CREATE INDEX "idx_hr_daily_report_date" ON "commerce_hr_daily_reports"("date" DESC);

-- CreateIndex
CREATE INDEX "idx_hr_daily_report_blocker" ON "commerce_hr_daily_reports"("blockerKey", "date");

-- CreateIndex
CREATE UNIQUE INDEX "uq_hr_daily_report_employee_date" ON "commerce_hr_daily_reports"("employeeId", "date");

-- CreateIndex
CREATE INDEX "idx_hr_reassign_from_date" ON "commerce_hr_work_reassignments"("fromEmployeeId", "date");

-- CreateIndex
CREATE INDEX "idx_hr_reassign_date" ON "commerce_hr_work_reassignments"("date");

-- CreateIndex
CREATE UNIQUE INDEX "commerce_hr_career_plans_employeeId_key" ON "commerce_hr_career_plans"("employeeId");

-- CreateIndex
CREATE INDEX "idx_hr_career_review_employee" ON "commerce_hr_career_reviews"("employeeId", "reviewedAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "commerce_hr_career_paths_role_key" ON "commerce_hr_career_paths"("role");

-- AddForeignKey
ALTER TABLE "commerce_hr_employee_documents" ADD CONSTRAINT "commerce_hr_employee_documents_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "commerce_hr_employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commerce_hr_onboarding_items" ADD CONSTRAINT "commerce_hr_onboarding_items_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "commerce_hr_employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commerce_hr_employee_history" ADD CONSTRAINT "commerce_hr_employee_history_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "commerce_hr_employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commerce_hr_attendance" ADD CONSTRAINT "commerce_hr_attendance_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "commerce_hr_employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commerce_hr_attendance_corrections" ADD CONSTRAINT "commerce_hr_attendance_corrections_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "commerce_hr_employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commerce_hr_rosters" ADD CONSTRAINT "commerce_hr_rosters_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "commerce_hr_employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commerce_hr_leave_balances" ADD CONSTRAINT "commerce_hr_leave_balances_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "commerce_hr_employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commerce_hr_leave_ledger" ADD CONSTRAINT "commerce_hr_leave_ledger_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "commerce_hr_employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commerce_hr_leave_requests" ADD CONSTRAINT "commerce_hr_leave_requests_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "commerce_hr_employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commerce_hr_daily_reports" ADD CONSTRAINT "commerce_hr_daily_reports_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "commerce_hr_employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commerce_hr_career_plans" ADD CONSTRAINT "commerce_hr_career_plans_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "commerce_hr_employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commerce_hr_career_reviews" ADD CONSTRAINT "commerce_hr_career_reviews_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "commerce_hr_employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Guards the service already applies, repeated where the database can enforce them.
ALTER TABLE "commerce_hr_attendance" ADD CONSTRAINT "ck_hr_attendance_clock_order"
  CHECK ("clockIn" IS NULL OR "clockOut" IS NULL OR "clockOut" > "clockIn");
ALTER TABLE "commerce_hr_rosters" ADD CONSTRAINT "ck_hr_roster_shift"
  CHECK ("shiftStartMin" >= 0 AND "shiftEndMin" <= 1440 AND "shiftEndMin" > "shiftStartMin");
ALTER TABLE "commerce_hr_leave_requests" ADD CONSTRAINT "ck_hr_leave_range"
  CHECK ("toDate" >= "fromDate" AND "chargeableHalfDays" >= 0);
-- The backstop for "two approvals cannot overspend one balance".
ALTER TABLE "commerce_hr_leave_balances" ADD CONSTRAINT "ck_hr_leave_balance_bounds"
  CHECK ("takenHalfDays" >= 0 AND "takenHalfDays" <= "entitledHalfDays");

-- Seeds: the employee-code counter (the first employee is EMP-00001), the default leave
-- policies (half-days per year; unpaid leave is never balance-limited) and the fallback
-- onboarding checklist. Done here, not lazily in code, so first use cannot race.
INSERT INTO "commerce_sequence_counters" ("name", "value") VALUES ('employee_code', 0)
  ON CONFLICT ("name") DO NOTHING;

INSERT INTO "commerce_hr_leave_policies" ("id", "type", "annualHalfDays", "carryForward", "updatedAt") VALUES
  (gen_random_uuid(), 'casual', 24, false, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'sick', 24, false, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'earned', 30, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'other', 6, false, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'unpaid', 0, false, CURRENT_TIMESTAMP)
  ON CONFLICT ("type") DO NOTHING;

INSERT INTO "commerce_hr_onboarding_template_items" ("id", "role", "position", "title", "category") VALUES
  (gen_random_uuid(), 'default', 0, 'Photo ID collected', 'documents'),
  (gen_random_uuid(), 'default', 1, 'Address proof collected', 'documents'),
  (gen_random_uuid(), 'default', 2, 'Signed contract on file', 'documents'),
  (gen_random_uuid(), 'default', 3, 'Uniform issued', 'equipment'),
  (gen_random_uuid(), 'default', 4, 'Login account created', 'access'),
  (gen_random_uuid(), 'default', 5, 'Safety briefing given', 'induction'),
  (gen_random_uuid(), 'default', 6, 'Store walk-through done', 'induction')
  ON CONFLICT ("role", "position") DO NOTHING;
