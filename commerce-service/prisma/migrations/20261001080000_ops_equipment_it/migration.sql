-- CreateEnum
CREATE TYPE "EquipmentType" AS ENUM ('washer', 'dryer', 'press', 'iron', 'boiler', 'generator', 'other');

-- CreateEnum
CREATE TYPE "EquipmentStatus" AS ENUM ('active', 'under_repair', 'out_of_service', 'retired');

-- CreateEnum
CREATE TYPE "EquipmentInspectionResult" AS ENUM ('pass', 'fail', 'needs_attention');

-- CreateEnum
CREATE TYPE "ItDeviceType" AS ENUM ('laptop', 'phone', 'tablet', 'printer', 'scanner', 'router', 'other');

-- CreateEnum
CREATE TYPE "ItDeviceStatus" AS ENUM ('in_stock', 'assigned', 'in_repair', 'retired');

-- CreateEnum
CREATE TYPE "ItDeviceCondition" AS ENUM ('new', 'good', 'fair', 'poor');

-- CreateEnum
CREATE TYPE "ItDeviceEventKind" AS ENUM ('registered', 'assigned', 'returned', 'status_changed');

-- CreateEnum
CREATE TYPE "ItLicenceEventKind" AS ENUM ('assigned', 'revoked');

-- CreateEnum
CREATE TYPE "ItRequestCategory" AS ENUM ('device_problem', 'software_issue', 'access_request', 'new_device', 'other');

-- CreateEnum
CREATE TYPE "ItRequestStatus" AS ENUM ('open', 'in_progress', 'resolved', 'closed');

-- CreateEnum
CREATE TYPE "ItRequestPriority" AS ENUM ('low', 'normal', 'high', 'urgent');

-- CreateEnum
CREATE TYPE "ItRequestEventKind" AS ENUM ('raised', 'status_changed', 'assigned', 'priority_changed', 'closed');

-- CreateTable
CREATE TABLE "commerce_equipment" (
    "id" UUID NOT NULL,
    "assetTag" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "EquipmentType" NOT NULL,
    "storeId" UUID NOT NULL,
    "machineId" UUID,
    "make" TEXT,
    "model" TEXT,
    "serialNumber" TEXT,
    "purchasedOn" DATE,
    "purchaseCostPaise" INTEGER,
    "capacityGrams" INTEGER,
    "status" "EquipmentStatus" NOT NULL DEFAULT 'active',
    "retiredAt" TIMESTAMPTZ(6),
    "retiredReason" TEXT,
    "createdByUserId" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "commerce_equipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce_equipment_status_events" (
    "id" UUID NOT NULL,
    "equipmentId" UUID NOT NULL,
    "fromStatus" "EquipmentStatus",
    "toStatus" "EquipmentStatus" NOT NULL,
    "reason" TEXT,
    "byUserId" UUID,
    "byName" TEXT NOT NULL,
    "at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commerce_equipment_status_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce_equipment_inspections" (
    "id" UUID NOT NULL,
    "equipmentId" UUID NOT NULL,
    "inspectedOn" DATE NOT NULL,
    "result" "EquipmentInspectionResult" NOT NULL,
    "checklist" JSONB NOT NULL DEFAULT '[]',
    "notes" TEXT,
    "inspectorUserId" UUID,
    "inspectorName" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commerce_equipment_inspections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce_equipment_repairs" (
    "id" UUID NOT NULL,
    "equipmentId" UUID NOT NULL,
    "reportedOn" DATE NOT NULL,
    "issue" TEXT NOT NULL,
    "costPaise" INTEGER,
    "vendorId" UUID,
    "resolvedOn" DATE,
    "downtimeMinutes" INTEGER,
    "notes" TEXT,
    "createdByUserId" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "commerce_equipment_repairs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce_equipment_maintenance_tasks" (
    "id" UUID NOT NULL,
    "equipmentId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "everyDays" INTEGER NOT NULL,
    "lastDoneOn" DATE,
    "nextDueOn" DATE NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "commerce_equipment_maintenance_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce_equipment_maintenance_logs" (
    "id" UUID NOT NULL,
    "equipmentId" UUID NOT NULL,
    "taskId" UUID,
    "taskName" TEXT NOT NULL,
    "doneOn" DATE NOT NULL,
    "costPaise" INTEGER,
    "notes" TEXT,
    "doneByUserId" UUID,
    "doneByName" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commerce_equipment_maintenance_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce_it_devices" (
    "id" UUID NOT NULL,
    "assetTag" TEXT NOT NULL,
    "type" "ItDeviceType" NOT NULL,
    "make" TEXT,
    "model" TEXT,
    "serialNumber" TEXT,
    "purchasedOn" DATE,
    "warrantyUntil" DATE,
    "condition" "ItDeviceCondition" NOT NULL DEFAULT 'good',
    "status" "ItDeviceStatus" NOT NULL DEFAULT 'in_stock',
    "assignedToEmployeeId" UUID,
    "assignedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "commerce_it_devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce_it_device_events" (
    "id" UUID NOT NULL,
    "deviceId" UUID NOT NULL,
    "kind" "ItDeviceEventKind" NOT NULL,
    "fromStatus" "ItDeviceStatus",
    "toStatus" "ItDeviceStatus" NOT NULL,
    "employeeId" UUID,
    "condition" "ItDeviceCondition",
    "note" TEXT,
    "byUserId" UUID,
    "byName" TEXT NOT NULL,
    "at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commerce_it_device_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce_it_device_repairs" (
    "id" UUID NOT NULL,
    "deviceId" UUID NOT NULL,
    "issue" TEXT NOT NULL,
    "costPaise" INTEGER,
    "repairedOn" DATE NOT NULL,
    "createdByUserId" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commerce_it_device_repairs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce_it_licences" (
    "id" UUID NOT NULL,
    "software" TEXT NOT NULL,
    "vendor" TEXT,
    "seats" INTEGER NOT NULL,
    "seatsUsed" INTEGER NOT NULL DEFAULT 0,
    "validUntil" DATE,
    "costPaise" INTEGER,
    "deletedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "commerce_it_licences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce_it_licence_seats" (
    "id" UUID NOT NULL,
    "licenceId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "assignedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assignedByUserId" UUID,

    CONSTRAINT "commerce_it_licence_seats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce_it_licence_events" (
    "id" UUID NOT NULL,
    "licenceId" UUID NOT NULL,
    "kind" "ItLicenceEventKind" NOT NULL,
    "employeeId" UUID NOT NULL,
    "byUserId" UUID,
    "byName" TEXT NOT NULL,
    "at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commerce_it_licence_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce_it_requests" (
    "id" UUID NOT NULL,
    "category" "ItRequestCategory" NOT NULL,
    "description" TEXT NOT NULL,
    "priority" "ItRequestPriority" NOT NULL DEFAULT 'normal',
    "status" "ItRequestStatus" NOT NULL DEFAULT 'open',
    "deviceId" UUID,
    "raisedByUserId" UUID NOT NULL,
    "raisedByName" TEXT NOT NULL,
    "assigneeUserId" UUID,
    "assigneeName" TEXT,
    "resolution" TEXT,
    "closedAt" TIMESTAMPTZ(6),
    "closedByUserId" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "commerce_it_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce_it_request_comments" (
    "id" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "authorUserId" UUID,
    "authorName" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commerce_it_request_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce_it_request_events" (
    "id" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "kind" "ItRequestEventKind" NOT NULL,
    "fromStatus" "ItRequestStatus",
    "toStatus" "ItRequestStatus",
    "detail" TEXT,
    "byUserId" UUID,
    "byName" TEXT NOT NULL,
    "at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commerce_it_request_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "commerce_equipment_assetTag_key" ON "commerce_equipment"("assetTag");

-- CreateIndex
CREATE INDEX "commerce_equipment_storeId_status_createdAt_idx" ON "commerce_equipment"("storeId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "commerce_equipment_status_createdAt_idx" ON "commerce_equipment"("status", "createdAt");

-- CreateIndex
CREATE INDEX "commerce_equipment_type_createdAt_idx" ON "commerce_equipment"("type", "createdAt");

-- CreateIndex
CREATE INDEX "commerce_equipment_status_events_equipmentId_at_idx" ON "commerce_equipment_status_events"("equipmentId", "at");

-- CreateIndex
CREATE INDEX "commerce_equipment_inspections_equipmentId_inspectedOn_idx" ON "commerce_equipment_inspections"("equipmentId", "inspectedOn");

-- CreateIndex
CREATE INDEX "commerce_equipment_repairs_equipmentId_reportedOn_idx" ON "commerce_equipment_repairs"("equipmentId", "reportedOn");

-- CreateIndex
CREATE INDEX "commerce_equipment_repairs_equipmentId_resolvedOn_idx" ON "commerce_equipment_repairs"("equipmentId", "resolvedOn");

-- CreateIndex
CREATE INDEX "commerce_equipment_repairs_reportedOn_idx" ON "commerce_equipment_repairs"("reportedOn");

-- CreateIndex
CREATE INDEX "commerce_equipment_maintenance_tasks_nextDueOn_idx" ON "commerce_equipment_maintenance_tasks"("nextDueOn");

-- CreateIndex
CREATE UNIQUE INDEX "commerce_equipment_maintenance_tasks_equipmentId_name_key" ON "commerce_equipment_maintenance_tasks"("equipmentId", "name");

-- CreateIndex
CREATE INDEX "commerce_equipment_maintenance_logs_equipmentId_doneOn_idx" ON "commerce_equipment_maintenance_logs"("equipmentId", "doneOn");

-- CreateIndex
CREATE UNIQUE INDEX "commerce_equipment_maintenance_logs_taskId_doneOn_key" ON "commerce_equipment_maintenance_logs"("taskId", "doneOn");

-- CreateIndex
CREATE UNIQUE INDEX "commerce_it_devices_assetTag_key" ON "commerce_it_devices"("assetTag");

-- CreateIndex
CREATE INDEX "commerce_it_devices_status_createdAt_idx" ON "commerce_it_devices"("status", "createdAt");

-- CreateIndex
CREATE INDEX "commerce_it_devices_type_createdAt_idx" ON "commerce_it_devices"("type", "createdAt");

-- CreateIndex
CREATE INDEX "commerce_it_devices_assignedToEmployeeId_idx" ON "commerce_it_devices"("assignedToEmployeeId");

-- CreateIndex
CREATE INDEX "commerce_it_device_events_deviceId_at_idx" ON "commerce_it_device_events"("deviceId", "at");

-- CreateIndex
CREATE INDEX "commerce_it_device_repairs_deviceId_repairedOn_idx" ON "commerce_it_device_repairs"("deviceId", "repairedOn");

-- CreateIndex
CREATE INDEX "commerce_it_licences_deletedAt_software_idx" ON "commerce_it_licences"("deletedAt", "software");

-- CreateIndex
CREATE UNIQUE INDEX "commerce_it_licence_seats_licenceId_employeeId_key" ON "commerce_it_licence_seats"("licenceId", "employeeId");

-- CreateIndex
CREATE INDEX "commerce_it_licence_events_licenceId_at_idx" ON "commerce_it_licence_events"("licenceId", "at");

-- CreateIndex
CREATE INDEX "commerce_it_requests_createdAt_idx" ON "commerce_it_requests"("createdAt");

-- CreateIndex
CREATE INDEX "commerce_it_requests_raisedByUserId_createdAt_idx" ON "commerce_it_requests"("raisedByUserId", "createdAt");

-- CreateIndex
CREATE INDEX "commerce_it_requests_status_createdAt_idx" ON "commerce_it_requests"("status", "createdAt");

-- CreateIndex
CREATE INDEX "commerce_it_requests_category_createdAt_idx" ON "commerce_it_requests"("category", "createdAt");

-- CreateIndex
CREATE INDEX "commerce_it_request_comments_requestId_createdAt_idx" ON "commerce_it_request_comments"("requestId", "createdAt");

-- CreateIndex
CREATE INDEX "commerce_it_request_events_requestId_at_idx" ON "commerce_it_request_events"("requestId", "at");

-- AddForeignKey
ALTER TABLE "commerce_equipment_status_events" ADD CONSTRAINT "commerce_equipment_status_events_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "commerce_equipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commerce_equipment_inspections" ADD CONSTRAINT "commerce_equipment_inspections_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "commerce_equipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commerce_equipment_repairs" ADD CONSTRAINT "commerce_equipment_repairs_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "commerce_equipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commerce_equipment_maintenance_tasks" ADD CONSTRAINT "commerce_equipment_maintenance_tasks_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "commerce_equipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commerce_equipment_maintenance_logs" ADD CONSTRAINT "commerce_equipment_maintenance_logs_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "commerce_equipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commerce_it_device_events" ADD CONSTRAINT "commerce_it_device_events_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "commerce_it_devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commerce_it_device_repairs" ADD CONSTRAINT "commerce_it_device_repairs_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "commerce_it_devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commerce_it_licence_seats" ADD CONSTRAINT "commerce_it_licence_seats_licenceId_fkey" FOREIGN KEY ("licenceId") REFERENCES "commerce_it_licences"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commerce_it_licence_events" ADD CONSTRAINT "commerce_it_licence_events_licenceId_fkey" FOREIGN KEY ("licenceId") REFERENCES "commerce_it_licences"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commerce_it_request_comments" ADD CONSTRAINT "commerce_it_request_comments_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "commerce_it_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commerce_it_request_events" ADD CONSTRAINT "commerce_it_request_events_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "commerce_it_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Counter behind generated equipment asset tags (EQ-00001, ...).
INSERT INTO "commerce_sequence_counters" ("name", "value") VALUES ('equipment_tag', 0) ON CONFLICT ("name") DO NOTHING;

-- Rules the application also enforces, kept in the database so a buggy caller cannot break them.
ALTER TABLE "commerce_equipment" ADD CONSTRAINT "commerce_equipment_amounts_check"
  CHECK (("purchaseCostPaise" IS NULL OR "purchaseCostPaise" >= 0) AND ("capacityGrams" IS NULL OR "capacityGrams" > 0));

ALTER TABLE "commerce_equipment_maintenance_tasks" ADD CONSTRAINT "commerce_equipment_maintenance_tasks_everyDays_check"
  CHECK ("everyDays" >= 1);

ALTER TABLE "commerce_it_devices" ADD CONSTRAINT "commerce_it_devices_assignment_check"
  CHECK (("status" = 'assigned') = ("assignedToEmployeeId" IS NOT NULL));

ALTER TABLE "commerce_it_licences" ADD CONSTRAINT "commerce_it_licences_seats_check"
  CHECK ("seats" >= 0 AND "seatsUsed" >= 0 AND "seatsUsed" <= "seats");
