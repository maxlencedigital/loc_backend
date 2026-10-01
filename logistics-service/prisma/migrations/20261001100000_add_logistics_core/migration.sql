-- CreateEnum
CREATE TYPE "VehicleType" AS ENUM ('bike', 'scooter', 'bicycle', 'ev', 'other');

-- CreateEnum
CREATE TYPE "IdType" AS ENUM ('aadhaar', 'pan', 'driving_licence', 'voter_id');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('id_proof', 'licence', 'vehicle_rc', 'insurance', 'photo');

-- CreateEnum
CREATE TYPE "ApplicationStatus" AS ENUM ('submitted', 'documents_requested', 'under_review', 'approved', 'rejected');

-- CreateEnum
CREATE TYPE "RiderStatus" AS ENUM ('active', 'suspended', 'inactive');

-- CreateEnum
CREATE TYPE "JobType" AS ENUM ('pickup', 'delivery');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('pending', 'assigned', 'en_route', 'arrived', 'picked_up', 'at_store', 'out_for_delivery', 'delivered', 'failed', 'cancelled');

-- CreateEnum
CREATE TYPE "JobPriority" AS ENUM ('normal', 'express');

-- CreateEnum
CREATE TYPE "ItemCondition" AS ENUM ('ok', 'stain', 'tear', 'loose_button', 'colour_fade', 'damaged', 'other');

-- CreateEnum
CREATE TYPE "PhotoKind" AS ENUM ('pickup', 'delivery');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('cash', 'upi', 'card');

-- CreateEnum
CREATE TYPE "FieldPaymentStatus" AS ENUM ('collected', 'settled');

-- CreateEnum
CREATE TYPE "LedgerKind" AS ENUM ('job_base', 'job_express', 'shift_bonus', 'bonus', 'penalty', 'payout');

-- CreateEnum
CREATE TYPE "OutboxKind" AS ENUM ('order_status', 'order_payment');

-- CreateEnum
CREATE TYPE "OutboxState" AS ENUM ('pending', 'done', 'dead');

-- CreateTable
CREATE TABLE "logistics_rider_applications" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "city" TEXT NOT NULL,
    "vehicleType" "VehicleType" NOT NULL,
    "vehicleNumber" TEXT NOT NULL,
    "drivingLicenceMasked" TEXT NOT NULL,
    "idType" "IdType" NOT NULL,
    "idNumberMasked" TEXT NOT NULL,
    "preferredStoreId" UUID,
    "status" "ApplicationStatus" NOT NULL DEFAULT 'submitted',
    "openPhone" TEXT,
    "uploadTokenHash" TEXT NOT NULL,
    "requestedDocuments" "DocumentType"[],
    "requestMessage" TEXT,
    "identityVerified" BOOLEAN,
    "vehicleVerified" BOOLEAN,
    "insuranceValid" BOOLEAN,
    "insuranceExpiry" DATE,
    "verifyNotes" TEXT,
    "verifiedByUserId" UUID,
    "verifiedAt" TIMESTAMPTZ(6),
    "decidedByUserId" UUID,
    "decidedAt" TIMESTAMPTZ(6),
    "decisionNotes" TEXT,
    "rejectionReason" TEXT,
    "submittedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "logistics_rider_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "logistics_application_documents" (
    "id" UUID NOT NULL,
    "applicationId" UUID NOT NULL,
    "type" "DocumentType" NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "logistics_application_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "logistics_riders" (
    "id" UUID NOT NULL,
    "userId" UUID,
    "applicationId" UUID,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "city" TEXT NOT NULL,
    "vehicleType" "VehicleType" NOT NULL,
    "vehicleNumber" TEXT NOT NULL,
    "homeStoreId" UUID,
    "status" "RiderStatus" NOT NULL DEFAULT 'inactive',
    "available" BOOLEAN NOT NULL DEFAULT false,
    "identityVerified" BOOLEAN NOT NULL DEFAULT false,
    "vehicleVerified" BOOLEAN NOT NULL DEFAULT false,
    "insuranceValid" BOOLEAN NOT NULL DEFAULT false,
    "insuranceExpiry" DATE,
    "lastLatitude" DOUBLE PRECISION,
    "lastLongitude" DOUBLE PRECISION,
    "lastLocationAt" TIMESTAMPTZ(6),
    "approvedByUserId" UUID,
    "approvedAt" TIMESTAMPTZ(6),
    "suspendedReason" TEXT,
    "suspendedByUserId" UUID,
    "suspendedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "logistics_riders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "logistics_rider_events" (
    "id" UUID NOT NULL,
    "riderId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "note" TEXT,
    "byUserId" UUID,
    "at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "logistics_rider_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "logistics_shifts" (
    "id" UUID NOT NULL,
    "riderId" UUID NOT NULL,
    "startedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMPTZ(6),
    "openRiderId" UUID,
    "startLatitude" DOUBLE PRECISION,
    "startLongitude" DOUBLE PRECISION,
    "vehicleChecked" BOOLEAN NOT NULL DEFAULT false,
    "odometerKm" DOUBLE PRECISION,
    "jobsCompleted" INTEGER,
    "distanceMeters" INTEGER,
    "earningsPaise" INTEGER,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "logistics_shifts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "logistics_jobs" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "type" "JobType" NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'pending',
    "priority" "JobPriority" NOT NULL DEFAULT 'normal',
    "storeId" UUID NOT NULL,
    "riderId" UUID,
    "shiftId" UUID,
    "customerName" TEXT NOT NULL,
    "customerPhone" TEXT NOT NULL,
    "addressLine1" TEXT NOT NULL,
    "addressLine2" TEXT,
    "landmark" TEXT,
    "city" TEXT,
    "pincode" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "coordinatesSource" TEXT,
    "slotFrom" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "slotTo" TIMESTAMPTZ(6),
    "sequence" INTEGER,
    "distanceMeters" INTEGER,
    "isPremium" BOOLEAN NOT NULL DEFAULT false,
    "isDelicate" BOOLEAN NOT NULL DEFAULT false,
    "requiresInspection" BOOLEAN NOT NULL DEFAULT false,
    "amountToCollectPaise" INTEGER NOT NULL DEFAULT 0,
    "collectedPaise" INTEGER NOT NULL DEFAULT 0,
    "careNotes" TEXT,
    "items" JSONB NOT NULL DEFAULT '[]',
    "notes" TEXT,
    "handoverCode" TEXT NOT NULL,
    "codeAttempts" INTEGER NOT NULL DEFAULT 0,
    "assignedAt" TIMESTAMPTZ(6),
    "startedAt" TIMESTAMPTZ(6),
    "arrivedAt" TIMESTAMPTZ(6),
    "pickedUpAt" TIMESTAMPTZ(6),
    "completedAt" TIMESTAMPTZ(6),
    "failedAt" TIMESTAMPTZ(6),
    "cancelledAt" TIMESTAMPTZ(6),
    "failureReason" TEXT,
    "failureNote" TEXT,
    "cancelReason" TEXT,
    "rescheduleCount" INTEGER NOT NULL DEFAULT 0,
    "durationMinutes" INTEGER,
    "onTime" BOOLEAN,
    "createdByUserId" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "logistics_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "logistics_job_proofs" (
    "id" UUID NOT NULL,
    "jobId" UUID NOT NULL,
    "confirmation" TEXT,
    "otpVerified" BOOLEAN NOT NULL DEFAULT false,
    "signature" TEXT,
    "receivedBy" TEXT,
    "itemCount" INTEGER,
    "overallNote" TEXT,
    "notes" TEXT,
    "handoffStoreId" UUID,
    "handoffItemCount" INTEGER,
    "handoffReceiverId" UUID,
    "handoffNotes" TEXT,
    "handoffAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "logistics_job_proofs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "logistics_job_events" (
    "id" UUID NOT NULL,
    "jobId" UUID NOT NULL,
    "status" "JobStatus" NOT NULL,
    "byUserId" UUID,
    "byName" TEXT,
    "note" TEXT,
    "at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "logistics_job_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "logistics_job_assignments" (
    "id" UUID NOT NULL,
    "jobId" UUID NOT NULL,
    "riderId" UUID NOT NULL,
    "assignedByUserId" UUID,
    "assignedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedAt" TIMESTAMPTZ(6),
    "releaseReason" TEXT,
    "activeJobId" UUID,

    CONSTRAINT "logistics_job_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "logistics_job_scans" (
    "id" UUID NOT NULL,
    "jobId" UUID NOT NULL,
    "tagId" TEXT NOT NULL,
    "condition" "ItemCondition" NOT NULL DEFAULT 'ok',
    "scannedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "logistics_job_scans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "logistics_job_inspections" (
    "id" UUID NOT NULL,
    "jobId" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "condition" "ItemCondition" NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "logistics_job_inspections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "logistics_job_photos" (
    "id" UUID NOT NULL,
    "jobId" UUID NOT NULL,
    "kind" "PhotoKind" NOT NULL,
    "itemId" UUID,
    "url" TEXT NOT NULL,
    "caption" TEXT,
    "uploadedByUserId" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "logistics_job_photos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "logistics_earnings" (
    "id" UUID NOT NULL,
    "riderId" UUID NOT NULL,
    "shiftId" UUID,
    "jobId" UUID,
    "kind" "LedgerKind" NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "reason" TEXT,
    "dedupeKey" TEXT,
    "createdByUserId" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "logistics_earnings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "logistics_field_payments" (
    "id" UUID NOT NULL,
    "jobId" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "riderId" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "reference" TEXT,
    "status" "FieldPaymentStatus" NOT NULL DEFAULT 'collected',
    "collectedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settledAt" TIMESTAMPTZ(6),
    "settledAmountPaise" INTEGER,
    "settledByUserId" UUID,
    "settledStoreId" UUID,
    "settleNote" TEXT,
    "idempotencyKey" TEXT,

    CONSTRAINT "logistics_field_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "logistics_rider_ratings" (
    "id" UUID NOT NULL,
    "jobId" UUID NOT NULL,
    "riderId" UUID NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "logistics_rider_ratings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "logistics_outbox" (
    "id" UUID NOT NULL,
    "kind" "OutboxKind" NOT NULL,
    "orderId" UUID NOT NULL,
    "jobId" UUID,
    "payload" JSONB NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "state" "OutboxState" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "nextAttemptAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "doneAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "logistics_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "logistics_rider_applications_openPhone_key" ON "logistics_rider_applications"("openPhone");

-- CreateIndex
CREATE INDEX "idx_rider_application_status_submitted" ON "logistics_rider_applications"("status", "submittedAt");

-- CreateIndex
CREATE INDEX "idx_rider_application_city_submitted" ON "logistics_rider_applications"("city", "submittedAt");

-- CreateIndex
CREATE INDEX "idx_rider_application_submitted" ON "logistics_rider_applications"("submittedAt");

-- CreateIndex
CREATE UNIQUE INDEX "uq_application_document_type" ON "logistics_application_documents"("applicationId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "logistics_riders_userId_key" ON "logistics_riders"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "logistics_riders_applicationId_key" ON "logistics_riders"("applicationId");

-- CreateIndex
CREATE UNIQUE INDEX "logistics_riders_phone_key" ON "logistics_riders"("phone");

-- CreateIndex
CREATE INDEX "idx_rider_status_available" ON "logistics_riders"("status", "available");

-- CreateIndex
CREATE INDEX "idx_rider_home_store_status" ON "logistics_riders"("homeStoreId", "status");

-- CreateIndex
CREATE INDEX "idx_rider_event_rider_at" ON "logistics_rider_events"("riderId", "at");

-- CreateIndex
CREATE UNIQUE INDEX "logistics_shifts_openRiderId_key" ON "logistics_shifts"("openRiderId");

-- CreateIndex
CREATE INDEX "idx_shift_rider_started" ON "logistics_shifts"("riderId", "startedAt");

-- CreateIndex
CREATE INDEX "idx_job_store_status_created" ON "logistics_jobs"("storeId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "idx_job_status_created" ON "logistics_jobs"("status", "createdAt");

-- CreateIndex
CREATE INDEX "idx_job_rider_status" ON "logistics_jobs"("riderId", "status");

-- CreateIndex
CREATE INDEX "idx_job_rider_slot" ON "logistics_jobs"("riderId", "slotFrom");

-- CreateIndex
CREATE INDEX "idx_job_store_slot" ON "logistics_jobs"("storeId", "slotFrom");

-- CreateIndex
CREATE INDEX "idx_job_rider_completed" ON "logistics_jobs"("riderId", "completedAt");

-- CreateIndex
CREATE INDEX "idx_job_shift" ON "logistics_jobs"("shiftId");

-- CreateIndex
CREATE UNIQUE INDEX "uq_job_order_type" ON "logistics_jobs"("orderId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "logistics_job_proofs_jobId_key" ON "logistics_job_proofs"("jobId");

-- CreateIndex
CREATE INDEX "idx_job_event_job_at" ON "logistics_job_events"("jobId", "at");

-- CreateIndex
CREATE UNIQUE INDEX "logistics_job_assignments_activeJobId_key" ON "logistics_job_assignments"("activeJobId");

-- CreateIndex
CREATE INDEX "idx_job_assignment_job" ON "logistics_job_assignments"("jobId");

-- CreateIndex
CREATE INDEX "idx_job_assignment_rider_assigned" ON "logistics_job_assignments"("riderId", "assignedAt");

-- CreateIndex
CREATE UNIQUE INDEX "uq_job_scan_tag" ON "logistics_job_scans"("jobId", "tagId");

-- CreateIndex
CREATE UNIQUE INDEX "uq_job_inspection_item" ON "logistics_job_inspections"("jobId", "itemId");

-- CreateIndex
CREATE INDEX "idx_job_photo_job_kind" ON "logistics_job_photos"("jobId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "logistics_earnings_dedupeKey_key" ON "logistics_earnings"("dedupeKey");

-- CreateIndex
CREATE INDEX "idx_ledger_rider_created" ON "logistics_earnings"("riderId", "createdAt");

-- CreateIndex
CREATE INDEX "idx_ledger_shift" ON "logistics_earnings"("shiftId");

-- CreateIndex
CREATE INDEX "idx_field_payment_rider_status" ON "logistics_field_payments"("riderId", "status");

-- CreateIndex
CREATE INDEX "idx_field_payment_store_status_collected" ON "logistics_field_payments"("storeId", "status", "collectedAt");

-- CreateIndex
CREATE INDEX "idx_field_payment_job" ON "logistics_field_payments"("jobId");

-- CreateIndex
CREATE INDEX "idx_field_payment_collected" ON "logistics_field_payments"("collectedAt");

-- CreateIndex
CREATE UNIQUE INDEX "uq_field_payment_idempotency" ON "logistics_field_payments"("riderId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "logistics_rider_ratings_jobId_key" ON "logistics_rider_ratings"("jobId");

-- CreateIndex
CREATE INDEX "idx_rating_rider_created" ON "logistics_rider_ratings"("riderId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "logistics_outbox_dedupeKey_key" ON "logistics_outbox"("dedupeKey");

-- CreateIndex
CREATE INDEX "idx_outbox_state_next" ON "logistics_outbox"("state", "nextAttemptAt");

-- AddForeignKey
ALTER TABLE "logistics_application_documents" ADD CONSTRAINT "logistics_application_documents_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "logistics_rider_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "logistics_riders" ADD CONSTRAINT "logistics_riders_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "logistics_rider_applications"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "logistics_rider_events" ADD CONSTRAINT "logistics_rider_events_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "logistics_riders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "logistics_shifts" ADD CONSTRAINT "logistics_shifts_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "logistics_riders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "logistics_jobs" ADD CONSTRAINT "logistics_jobs_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "logistics_riders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "logistics_job_proofs" ADD CONSTRAINT "logistics_job_proofs_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "logistics_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "logistics_job_events" ADD CONSTRAINT "logistics_job_events_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "logistics_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "logistics_job_assignments" ADD CONSTRAINT "logistics_job_assignments_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "logistics_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "logistics_job_assignments" ADD CONSTRAINT "logistics_job_assignments_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "logistics_riders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "logistics_job_scans" ADD CONSTRAINT "logistics_job_scans_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "logistics_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "logistics_job_inspections" ADD CONSTRAINT "logistics_job_inspections_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "logistics_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "logistics_job_photos" ADD CONSTRAINT "logistics_job_photos_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "logistics_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "logistics_earnings" ADD CONSTRAINT "logistics_earnings_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "logistics_riders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "logistics_field_payments" ADD CONSTRAINT "logistics_field_payments_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "logistics_jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "logistics_field_payments" ADD CONSTRAINT "logistics_field_payments_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "logistics_riders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "logistics_rider_ratings" ADD CONSTRAINT "logistics_rider_ratings_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "logistics_jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "logistics_rider_ratings" ADD CONSTRAINT "logistics_rider_ratings_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "logistics_riders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

