-- CreateEnum
CREATE TYPE "HrTrainingCategory" AS ENUM ('software', 'customer_handling', 'safety', 'compliance', 'other');

-- CreateEnum
CREATE TYPE "HrTrainingStatus" AS ENUM ('assigned', 'in_progress', 'completed');

-- CreateEnum
CREATE TYPE "HrAppraisalStatus" AS ENUM ('scheduled', 'in_progress', 'completed');

-- CreateEnum
CREATE TYPE "HrAppraisalOutcome" AS ENUM ('promoted', 'increment', 'no_change', 'improvement_plan', 'other');

-- CreateEnum
CREATE TYPE "HrPayCycle" AS ENUM ('monthly', 'weekly', 'per_job');

-- CreateEnum
CREATE TYPE "HrIncentiveAppliesTo" AS ENUM ('staff', 'rider', 'both');

-- CreateEnum
CREATE TYPE "HrIncentiveMetricKind" AS ENUM ('jobs_completed', 'orders_processed', 'rating', 'attendance', 'distance');

-- CreateEnum
CREATE TYPE "HrIncentivePeriod" AS ENUM ('daily', 'weekly', 'monthly');

-- CreateEnum
CREATE TYPE "HrIncentiveEarningStatus" AS ENUM ('pending', 'approved', 'paid');

-- CreateEnum
CREATE TYPE "HrPayoutType" AS ENUM ('salary', 'incentive', 'bonus', 'advance');

-- CreateEnum
CREATE TYPE "HrGrievanceCategory" AS ENUM ('harassment', 'pay', 'workload', 'safety', 'management', 'discrimination', 'other');

-- CreateEnum
CREATE TYPE "HrGrievanceStatus" AS ENUM ('open', 'assigned', 'in_progress', 'escalated', 'closed');

-- CreateEnum
CREATE TYPE "HrGrievanceNoteKind" AS ENUM ('comment', 'assignment', 'escalation', 'closure');

-- CreateEnum
CREATE TYPE "HrRequestCategory" AS ENUM ('leave_policy', 'payroll', 'documents', 'benefits', 'other');

-- CreateEnum
CREATE TYPE "HrRequestStatus" AS ENUM ('open', 'answered', 'closed');

-- CreateTable
CREATE TABLE "commerce_hr_training_courses" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "category" "HrTrainingCategory" NOT NULL,
    "description" TEXT,
    "durationMinutes" INTEGER,
    "materialUrl" TEXT,
    "validForDays" INTEGER,
    "deletedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "commerce_hr_training_courses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce_hr_training_requirements" (
    "id" UUID NOT NULL,
    "roleKey" TEXT NOT NULL,
    "courseId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commerce_hr_training_requirements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce_hr_training_assignments" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "courseId" UUID NOT NULL,
    "status" "HrTrainingStatus" NOT NULL DEFAULT 'assigned',
    "isOpen" BOOLEAN DEFAULT true,
    "dueDate" DATE NOT NULL,
    "validForDays" INTEGER,
    "startedAt" TIMESTAMPTZ(6),
    "completedAt" TIMESTAMPTZ(6),
    "scoreHundredths" INTEGER,
    "expiresAt" DATE,
    "supersededAt" TIMESTAMPTZ(6),
    "assignedByName" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "commerce_hr_training_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce_hr_appraisals" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "cycle" TEXT NOT NULL,
    "scheduledFor" DATE NOT NULL,
    "reviewerId" UUID,
    "status" "HrAppraisalStatus" NOT NULL DEFAULT 'scheduled',
    "rating" INTEGER,
    "strengths" TEXT,
    "improvements" TEXT,
    "goals" TEXT[],
    "conductedAt" TIMESTAMPTZ(6),
    "conductedByName" TEXT,
    "outcome" "HrAppraisalOutcome",
    "outcomeNote" TEXT,
    "completedAt" TIMESTAMPTZ(6),
    "completedByName" TEXT,
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "commerce_hr_appraisals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce_hr_compensation" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "baseSalaryPaise" INTEGER NOT NULL,
    "payCycle" "HrPayCycle" NOT NULL DEFAULT 'monthly',
    "allowances" JSONB NOT NULL,
    "bonusEligible" BOOLEAN NOT NULL DEFAULT false,
    "effectiveFrom" DATE NOT NULL,
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commerce_hr_compensation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce_hr_incentive_schemes" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "appliesTo" "HrIncentiveAppliesTo" NOT NULL,
    "metric" "HrIncentiveMetricKind" NOT NULL,
    "period" "HrIncentivePeriod" NOT NULL DEFAULT 'monthly',
    "rules" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "commerce_hr_incentive_schemes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce_hr_incentive_assignments" (
    "id" UUID NOT NULL,
    "schemeId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "assignedByName" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commerce_hr_incentive_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce_hr_incentive_metrics" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "metric" "HrIncentiveMetricKind" NOT NULL,
    "period" TEXT NOT NULL,
    "valueMilli" INTEGER NOT NULL,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "commerce_hr_incentive_metrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce_hr_incentive_earnings" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "schemeId" UUID NOT NULL,
    "schemeName" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "metricValueMilli" INTEGER NOT NULL,
    "rewardPaise" INTEGER NOT NULL,
    "status" "HrIncentiveEarningStatus" NOT NULL DEFAULT 'pending',
    "approvedAt" TIMESTAMPTZ(6),
    "approvedByName" TEXT,
    "paidAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "commerce_hr_incentive_earnings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce_hr_payouts" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "type" "HrPayoutType" NOT NULL,
    "period" TEXT NOT NULL,
    "paidOn" DATE NOT NULL,
    "reference" TEXT,
    "idempotencyKey" TEXT,
    "recordedByUserId" TEXT NOT NULL,
    "recordedByName" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commerce_hr_payouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce_hr_grievances" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "againstEmployeeId" UUID,
    "category" "HrGrievanceCategory" NOT NULL,
    "description" TEXT NOT NULL,
    "anonymous" BOOLEAN NOT NULL DEFAULT false,
    "confidential" BOOLEAN NOT NULL DEFAULT true,
    "status" "HrGrievanceStatus" NOT NULL DEFAULT 'open',
    "assigneeId" UUID,
    "assignedAt" TIMESTAMPTZ(6),
    "raisedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "firstResponseDueAt" TIMESTAMPTZ(6) NOT NULL,
    "resolutionDueAt" TIMESTAMPTZ(6) NOT NULL,
    "firstResponseAt" TIMESTAMPTZ(6),
    "escalatedAt" TIMESTAMPTZ(6),
    "escalationReason" TEXT,
    "closedAt" TIMESTAMPTZ(6),
    "outcome" TEXT,
    "closedByName" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "commerce_hr_grievances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce_hr_grievance_notes" (
    "id" UUID NOT NULL,
    "grievanceId" UUID NOT NULL,
    "kind" "HrGrievanceNoteKind" NOT NULL DEFAULT 'comment',
    "message" TEXT NOT NULL,
    "internal" BOOLEAN NOT NULL DEFAULT false,
    "authorName" TEXT NOT NULL,
    "authorUserId" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commerce_hr_grievance_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce_hr_requests" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "category" "HrRequestCategory" NOT NULL,
    "message" TEXT NOT NULL,
    "status" "HrRequestStatus" NOT NULL DEFAULT 'open',
    "response" TEXT,
    "respondedAt" TIMESTAMPTZ(6),
    "respondedByName" TEXT,
    "closedAt" TIMESTAMPTZ(6),
    "closeNote" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "commerce_hr_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_hr_course_list" ON "commerce_hr_training_courses"("deletedAt", "title");

-- CreateIndex
CREATE INDEX "idx_hr_training_requirement_course" ON "commerce_hr_training_requirements"("courseId");

-- CreateIndex
CREATE UNIQUE INDEX "uq_hr_training_requirement" ON "commerce_hr_training_requirements"("roleKey", "courseId");

-- CreateIndex
CREATE INDEX "idx_hr_training_employee" ON "commerce_hr_training_assignments"("employeeId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "idx_hr_training_course" ON "commerce_hr_training_assignments"("courseId");

-- CreateIndex
CREATE INDEX "idx_hr_training_status_due" ON "commerce_hr_training_assignments"("status", "dueDate");

-- CreateIndex
CREATE INDEX "idx_hr_training_status_expiry" ON "commerce_hr_training_assignments"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "uq_hr_training_open" ON "commerce_hr_training_assignments"("employeeId", "courseId", "isOpen");

-- CreateIndex
CREATE INDEX "idx_hr_appraisal_employee" ON "commerce_hr_appraisals"("employeeId", "scheduledFor" DESC);

-- CreateIndex
CREATE INDEX "idx_hr_appraisal_status" ON "commerce_hr_appraisals"("status", "scheduledFor" DESC);

-- CreateIndex
CREATE INDEX "idx_hr_appraisal_cycle_status" ON "commerce_hr_appraisals"("cycle", "status");

-- CreateIndex
CREATE INDEX "idx_hr_appraisal_scheduled" ON "commerce_hr_appraisals"("scheduledFor" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "uq_hr_appraisal_cycle" ON "commerce_hr_appraisals"("employeeId", "cycle");

-- CreateIndex
CREATE UNIQUE INDEX "uq_hr_compensation_effective" ON "commerce_hr_compensation"("employeeId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "idx_hr_scheme_name" ON "commerce_hr_incentive_schemes"("name");

-- CreateIndex
CREATE INDEX "idx_hr_scheme_assignment_employee" ON "commerce_hr_incentive_assignments"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "uq_hr_scheme_assignment" ON "commerce_hr_incentive_assignments"("schemeId", "employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "uq_hr_incentive_metric" ON "commerce_hr_incentive_metrics"("employeeId", "metric", "period");

-- CreateIndex
CREATE INDEX "idx_hr_earning_status" ON "commerce_hr_incentive_earnings"("status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "idx_hr_earning_employee" ON "commerce_hr_incentive_earnings"("employeeId", "periodStart");

-- CreateIndex
CREATE INDEX "idx_hr_earning_period" ON "commerce_hr_incentive_earnings"("periodStart");

-- CreateIndex
CREATE INDEX "idx_hr_earning_scheme" ON "commerce_hr_incentive_earnings"("schemeId");

-- CreateIndex
CREATE UNIQUE INDEX "uq_hr_incentive_earning" ON "commerce_hr_incentive_earnings"("employeeId", "schemeId", "period");

-- CreateIndex
CREATE INDEX "idx_hr_payout_employee" ON "commerce_hr_payouts"("employeeId", "paidOn" DESC);

-- CreateIndex
CREATE INDEX "idx_hr_payout_paid_on" ON "commerce_hr_payouts"("paidOn" DESC);

-- CreateIndex
CREATE INDEX "idx_hr_payout_sum" ON "commerce_hr_payouts"("employeeId", "type", "period");

-- CreateIndex
CREATE UNIQUE INDEX "uq_hr_payout_idempotency" ON "commerce_hr_payouts"("recordedByUserId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "idx_hr_grievance_status" ON "commerce_hr_grievances"("status", "raisedAt" DESC);

-- CreateIndex
CREATE INDEX "idx_hr_grievance_category" ON "commerce_hr_grievances"("category", "raisedAt" DESC);

-- CreateIndex
CREATE INDEX "idx_hr_grievance_assignee" ON "commerce_hr_grievances"("assigneeId", "raisedAt" DESC);

-- CreateIndex
CREATE INDEX "idx_hr_grievance_employee" ON "commerce_hr_grievances"("employeeId", "raisedAt" DESC);

-- CreateIndex
CREATE INDEX "idx_hr_grievance_against" ON "commerce_hr_grievances"("againstEmployeeId");

-- CreateIndex
CREATE INDEX "idx_hr_grievance_raised" ON "commerce_hr_grievances"("raisedAt" DESC);

-- CreateIndex
CREATE INDEX "idx_hr_grievance_note" ON "commerce_hr_grievance_notes"("grievanceId", "createdAt");

-- CreateIndex
CREATE INDEX "idx_hr_request_status" ON "commerce_hr_requests"("status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "idx_hr_request_category" ON "commerce_hr_requests"("category", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "idx_hr_request_employee" ON "commerce_hr_requests"("employeeId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "idx_hr_request_created" ON "commerce_hr_requests"("createdAt" DESC);

-- AddForeignKey
ALTER TABLE "commerce_hr_training_requirements" ADD CONSTRAINT "commerce_hr_training_requirements_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "commerce_hr_training_courses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commerce_hr_training_assignments" ADD CONSTRAINT "commerce_hr_training_assignments_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "commerce_hr_training_courses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commerce_hr_incentive_assignments" ADD CONSTRAINT "commerce_hr_incentive_assignments_schemeId_fkey" FOREIGN KEY ("schemeId") REFERENCES "commerce_hr_incentive_schemes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commerce_hr_incentive_earnings" ADD CONSTRAINT "commerce_hr_incentive_earnings_schemeId_fkey" FOREIGN KEY ("schemeId") REFERENCES "commerce_hr_incentive_schemes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commerce_hr_grievance_notes" ADD CONSTRAINT "commerce_hr_grievance_notes_grievanceId_fkey" FOREIGN KEY ("grievanceId") REFERENCES "commerce_hr_grievances"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Check constraints Prisma cannot express: the database refuses nonsense even if a service bug writes it.
ALTER TABLE "commerce_hr_training_assignments" ADD CONSTRAINT "ck_hr_training_score" CHECK ("scoreHundredths" IS NULL OR ("scoreHundredths" >= 0 AND "scoreHundredths" <= 10000));
ALTER TABLE "commerce_hr_training_assignments" ADD CONSTRAINT "ck_hr_training_open_state" CHECK (("status" = 'completed') = ("isOpen" IS NULL));
ALTER TABLE "commerce_hr_training_courses" ADD CONSTRAINT "ck_hr_course_valid_days" CHECK ("validForDays" IS NULL OR "validForDays" > 0);
ALTER TABLE "commerce_hr_appraisals" ADD CONSTRAINT "ck_hr_appraisal_rating" CHECK ("rating" IS NULL OR ("rating" >= 1 AND "rating" <= 5));
ALTER TABLE "commerce_hr_compensation" ADD CONSTRAINT "ck_hr_compensation_base" CHECK ("baseSalaryPaise" >= 0);
ALTER TABLE "commerce_hr_incentive_earnings" ADD CONSTRAINT "ck_hr_earning_reward" CHECK ("rewardPaise" >= 0);
ALTER TABLE "commerce_hr_payouts" ADD CONSTRAINT "ck_hr_payout_amount" CHECK ("amountPaise" > 0);

-- Append-only tables: pay terms, payouts and grievance notes are never edited or removed.
CREATE FUNCTION hr_people_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "tg_hr_compensation_append_only" BEFORE UPDATE OR DELETE ON "commerce_hr_compensation" FOR EACH ROW EXECUTE FUNCTION hr_people_append_only();
CREATE TRIGGER "tg_hr_payouts_append_only" BEFORE UPDATE OR DELETE ON "commerce_hr_payouts" FOR EACH ROW EXECUTE FUNCTION hr_people_append_only();
CREATE TRIGGER "tg_hr_grievance_notes_append_only" BEFORE UPDATE OR DELETE ON "commerce_hr_grievance_notes" FOR EACH ROW EXECUTE FUNCTION hr_people_append_only();
