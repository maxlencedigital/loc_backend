-- CreateEnum
CREATE TYPE "ComplianceType" AS ENUM ('licence', 'registration', 'certificate', 'permit', 'other');

-- CreateEnum
CREATE TYPE "AuditType" AS ENUM ('internal', 'external');

-- CreateEnum
CREATE TYPE "AuditStatus" AS ENUM ('scheduled', 'in_progress', 'completed', 'cancelled');

-- CreateEnum
CREATE TYPE "AuditFindingStatus" AS ENUM ('open', 'in_progress', 'closed');

-- CreateEnum
CREATE TYPE "AuditFindingSeverity" AS ENUM ('low', 'medium', 'high', 'critical');

-- CreateEnum
CREATE TYPE "SafetyIncidentType" AS ENUM ('injury', 'near_miss', 'fire_risk', 'security', 'hospitalisation', 'property_damage', 'vehicle_accident', 'unsafe_condition', 'other');

-- CreateEnum
CREATE TYPE "SafetyIncidentStatus" AS ENUM ('open', 'assigned', 'in_progress', 'escalated', 'closed');

-- CreateEnum
CREATE TYPE "SafetyIncidentSeverity" AS ENUM ('low', 'medium', 'high', 'critical');

-- CreateTable
CREATE TABLE "commerce_compliance_items" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" "ComplianceType" NOT NULL,
    "authority" TEXT,
    "referenceNumber" TEXT,
    "issuedOn" DATE,
    "expiresOn" DATE NOT NULL,
    "storeId" UUID,
    "ownerId" UUID,
    "checklist" JSONB NOT NULL DEFAULT '[]',
    "documents" JSONB NOT NULL DEFAULT '[]',
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "commerce_compliance_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce_compliance_renewals" (
    "id" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "previousExpiresOn" DATE NOT NULL,
    "newExpiresOn" DATE NOT NULL,
    "previousReferenceNumber" TEXT,
    "referenceNumber" TEXT,
    "renewedBy" UUID NOT NULL,
    "renewedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commerce_compliance_renewals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce_audits" (
    "id" UUID NOT NULL,
    "type" "AuditType" NOT NULL,
    "title" TEXT NOT NULL,
    "scope" TEXT,
    "auditor" TEXT,
    "storeId" UUID,
    "scheduledFor" DATE NOT NULL,
    "status" "AuditStatus" NOT NULL DEFAULT 'scheduled',
    "checklist" JSONB NOT NULL DEFAULT '[]',
    "startedAt" TIMESTAMPTZ(6),
    "completedAt" TIMESTAMPTZ(6),
    "summary" TEXT,
    "waiverReason" TEXT,
    "cancelReason" TEXT,
    "cancelledAt" TIMESTAMPTZ(6),
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "commerce_audits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce_audit_findings" (
    "id" UUID NOT NULL,
    "auditId" UUID NOT NULL,
    "storeId" UUID,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "severity" "AuditFindingSeverity" NOT NULL,
    "status" "AuditFindingStatus" NOT NULL DEFAULT 'open',
    "ownerId" UUID,
    "dueDate" DATE,
    "correctiveAction" TEXT,
    "evidence" TEXT,
    "closedAt" TIMESTAMPTZ(6),
    "closedBy" UUID,
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "commerce_audit_findings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce_safety_incidents" (
    "id" UUID NOT NULL,
    "type" "SafetyIncidentType" NOT NULL,
    "description" TEXT NOT NULL,
    "occurredAt" TIMESTAMPTZ(6) NOT NULL,
    "severity" "SafetyIncidentSeverity" NOT NULL,
    "status" "SafetyIncidentStatus" NOT NULL DEFAULT 'open',
    "storeId" UUID,
    "location" TEXT,
    "peopleInvolved" JSONB NOT NULL DEFAULT '[]',
    "immediateAction" TEXT,
    "reportedBy" UUID NOT NULL,
    "reportedByName" TEXT,
    "assigneeId" UUID,
    "assignedAt" TIMESTAMPTZ(6),
    "escalatedAt" TIMESTAMPTZ(6),
    "escalationReason" TEXT,
    "photos" JSONB NOT NULL DEFAULT '[]',
    "actionCount" INTEGER NOT NULL DEFAULT 0,
    "closedAt" TIMESTAMPTZ(6),
    "closedBy" UUID,
    "outcome" TEXT,
    "rootCause" TEXT,
    "preventiveMeasures" TEXT,
    "claimId" UUID,
    "claimedAt" TIMESTAMPTZ(6),
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "commerce_safety_incidents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce_ops_activity" (
    "id" UUID NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "actorId" UUID NOT NULL,
    "actorName" TEXT,
    "storeId" UUID,
    "fromStatus" TEXT,
    "toStatus" TEXT,
    "detail" JSONB,
    "at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commerce_ops_activity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_compliance_expires" ON "commerce_compliance_items"("expiresOn");

-- CreateIndex
CREATE INDEX "idx_compliance_store_expires" ON "commerce_compliance_items"("storeId", "expiresOn");

-- CreateIndex
CREATE INDEX "idx_compliance_type_expires" ON "commerce_compliance_items"("type", "expiresOn");

-- CreateIndex
CREATE INDEX "idx_compliance_renewal_item" ON "commerce_compliance_renewals"("itemId", "renewedAt");

-- CreateIndex
CREATE INDEX "idx_audit_scheduled" ON "commerce_audits"("scheduledFor");

-- CreateIndex
CREATE INDEX "idx_audit_store_scheduled" ON "commerce_audits"("storeId", "scheduledFor");

-- CreateIndex
CREATE INDEX "idx_audit_status_scheduled" ON "commerce_audits"("status", "scheduledFor");

-- CreateIndex
CREATE INDEX "idx_audit_type_scheduled" ON "commerce_audits"("type", "scheduledFor");

-- CreateIndex
CREATE INDEX "idx_finding_audit_created" ON "commerce_audit_findings"("auditId", "createdAt");

-- CreateIndex
CREATE INDEX "idx_finding_audit_status" ON "commerce_audit_findings"("auditId", "status");

-- CreateIndex
CREATE INDEX "idx_finding_open_queue" ON "commerce_audit_findings"("status", "severity", "dueDate");

-- CreateIndex
CREATE INDEX "idx_finding_owner_status" ON "commerce_audit_findings"("ownerId", "status");

-- CreateIndex
CREATE INDEX "idx_finding_store_status" ON "commerce_audit_findings"("storeId", "status");

-- CreateIndex
CREATE INDEX "idx_incident_occurred" ON "commerce_safety_incidents"("occurredAt");

-- CreateIndex
CREATE INDEX "idx_incident_store_occurred" ON "commerce_safety_incidents"("storeId", "occurredAt");

-- CreateIndex
CREATE INDEX "idx_incident_status_occurred" ON "commerce_safety_incidents"("status", "occurredAt");

-- CreateIndex
CREATE INDEX "idx_incident_type_occurred" ON "commerce_safety_incidents"("type", "occurredAt");

-- CreateIndex
CREATE INDEX "idx_incident_severity_occurred" ON "commerce_safety_incidents"("severity", "occurredAt");

-- CreateIndex
CREATE INDEX "idx_incident_escalated" ON "commerce_safety_incidents"("status", "escalatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "uq_incident_reporter_key" ON "commerce_safety_incidents"("reportedBy", "idempotencyKey");

-- CreateIndex
CREATE INDEX "idx_ops_activity_entity" ON "commerce_ops_activity"("entity", "entityId", "at");

-- CreateIndex
CREATE INDEX "idx_ops_activity_at" ON "commerce_ops_activity"("at");

-- CreateIndex
CREATE INDEX "idx_ops_activity_actor" ON "commerce_ops_activity"("actorId", "at");

-- CreateIndex
CREATE INDEX "idx_ops_activity_entity_at" ON "commerce_ops_activity"("entity", "at");

-- CreateIndex
CREATE INDEX "idx_ops_activity_action" ON "commerce_ops_activity"("action", "at");

-- One compliance item per (store, type, name); company-wide items (no store) are unique per (type, name).
-- Postgres treats NULLs as distinct, so a single unique index could not cover both.
CREATE UNIQUE INDEX "uq_compliance_store_type_name" ON "commerce_compliance_items"("storeId", "type", "name") WHERE "storeId" IS NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "uq_compliance_company_type_name" ON "commerce_compliance_items"("type", "name") WHERE "storeId" IS NULL;

-- AddForeignKey
ALTER TABLE "commerce_compliance_renewals" ADD CONSTRAINT "commerce_compliance_renewals_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "commerce_compliance_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commerce_audit_findings" ADD CONSTRAINT "commerce_audit_findings_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "commerce_audits"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
