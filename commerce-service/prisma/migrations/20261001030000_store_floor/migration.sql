-- CreateEnum
CREATE TYPE "FloorPieceStage" AS ENUM ('received', 'sorted', 'washing', 'drying', 'quality_check', 'packed');

-- CreateEnum
CREATE TYPE "FloorMachineType" AS ENUM ('washer', 'dryer', 'press', 'iron', 'other');

-- CreateEnum
CREATE TYPE "FloorMachineState" AS ENUM ('idle', 'reserved', 'running', 'maintenance', 'faulted');

-- CreateEnum
CREATE TYPE "FloorBatchStage" AS ENUM ('washing', 'drying');

-- CreateEnum
CREATE TYPE "FloorBatchStatus" AS ENUM ('planned', 'in_machine', 'finished', 'cancelled');

-- CreateEnum
CREATE TYPE "FloorFaultSeverity" AS ENUM ('low', 'medium', 'high', 'stopped');

-- CreateEnum
CREATE TYPE "FloorFaultStatus" AS ENUM ('open', 'resolved');

-- CreateEnum
CREATE TYPE "FloorCheckStatus" AS ENUM ('ok', 'needs_attention');

-- CreateEnum
CREATE TYPE "FloorQcOutcome" AS ENUM ('pass', 'fail');

-- CreateTable
CREATE TABLE "commerce_fabric_risk_rules" (
    "id" UUID NOT NULL,
    "fabric" TEXT NOT NULL,
    "risk" TEXT NOT NULL,
    "handling" TEXT NOT NULL,
    "washProgramme" TEXT NOT NULL,
    "dryProgramme" TEXT NOT NULL,
    "maxTemperatureC" INTEGER NOT NULL,
    "cycle" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "commerce_fabric_risk_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce_garment_pieces" (
    "id" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "orderRef" TEXT NOT NULL,
    "serviceId" UUID NOT NULL,
    "garmentTypeId" UUID,
    "tagCode" TEXT NOT NULL,
    "garment" TEXT NOT NULL,
    "condition" TEXT NOT NULL DEFAULT 'ok',
    "fabric" TEXT NOT NULL DEFAULT 'unknown',
    "colour" TEXT NOT NULL DEFAULT 'multi',
    "soilLevel" TEXT NOT NULL DEFAULT 'normal',
    "riskClass" TEXT NOT NULL DEFAULT 'low',
    "careFlags" TEXT[],
    "note" TEXT,
    "priority" TEXT NOT NULL DEFAULT 'standard',
    "dueAt" TIMESTAMPTZ(6) NOT NULL,
    "stage" "FloorPieceStage" NOT NULL DEFAULT 'received',
    "activeBatchId" UUID,
    "processWash" TEXT,
    "processDry" TEXT,
    "processTemperatureC" INTEGER,
    "processCycle" TEXT,
    "suggestedWash" TEXT,
    "suggestedDry" TEXT,
    "overrideReason" TEXT,
    "processSetBy" TEXT,
    "processSetAt" TIMESTAMPTZ(6),
    "qcPassedAt" TIMESTAMPTZ(6),
    "reworkCount" INTEGER NOT NULL DEFAULT 0,
    "receivedFrom" TEXT NOT NULL,
    "receivedByName" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "commerce_garment_pieces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce_floor_tag_counters" (
    "storeId" UUID NOT NULL,
    "value" INTEGER NOT NULL,

    CONSTRAINT "commerce_floor_tag_counters_pkey" PRIMARY KEY ("storeId")
);

-- CreateTable
CREATE TABLE "commerce_floor_machines" (
    "id" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "FloorMachineType" NOT NULL,
    "capacityGrams" INTEGER NOT NULL,
    "cycleMinutes" INTEGER NOT NULL DEFAULT 45,
    "state" "FloorMachineState" NOT NULL DEFAULT 'idle',
    "currentBatchId" UUID,
    "reservedUntil" TIMESTAMPTZ(6),
    "freeAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "commerce_floor_machines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce_floor_machine_checks" (
    "id" UUID NOT NULL,
    "machineId" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "checkDate" DATE NOT NULL,
    "status" "FloorCheckStatus" NOT NULL,
    "checklist" JSONB NOT NULL,
    "note" TEXT,
    "checkedByName" TEXT NOT NULL,
    "checkedByUserId" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "commerce_floor_machine_checks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce_floor_machine_faults" (
    "id" UUID NOT NULL,
    "machineId" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "severity" "FloorFaultSeverity" NOT NULL,
    "status" "FloorFaultStatus" NOT NULL DEFAULT 'open',
    "reportedByName" TEXT NOT NULL,
    "reportedByUserId" TEXT,
    "resolvedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commerce_floor_machine_faults_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce_floor_batches" (
    "id" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "serviceId" UUID NOT NULL,
    "stage" "FloorBatchStage" NOT NULL,
    "status" "FloorBatchStatus" NOT NULL DEFAULT 'planned',
    "machineId" UUID,
    "dueAt" TIMESTAMPTZ(6),
    "startedAt" TIMESTAMPTZ(6),
    "finishedAt" TIMESTAMPTZ(6),
    "loadWeightGrams" INTEGER,
    "notes" TEXT,
    "createdByName" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "commerce_floor_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce_floor_batch_pieces" (
    "id" UUID NOT NULL,
    "batchId" UUID NOT NULL,
    "pieceId" UUID NOT NULL,
    "addedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commerce_floor_batch_pieces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce_quality_checks" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "outcome" "FloorQcOutcome" NOT NULL,
    "byName" TEXT NOT NULL,
    "byUserId" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commerce_quality_checks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce_quality_check_results" (
    "id" UUID NOT NULL,
    "checkId" UUID NOT NULL,
    "pieceId" UUID NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "note" TEXT,
    "comparedWithPickupNotes" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "commerce_quality_check_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce_order_notes" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "note" TEXT NOT NULL,
    "byName" TEXT NOT NULL,
    "byUserId" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commerce_order_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce_order_collections" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "collectedBy" TEXT NOT NULL,
    "signature" TEXT,
    "paymentOutstanding" BOOLEAN NOT NULL,
    "byName" TEXT NOT NULL,
    "byUserId" TEXT,
    "collectedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commerce_order_collections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce_walkin_requests" (
    "id" UUID NOT NULL,
    "userId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "orderId" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commerce_walkin_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce_capacity_settings" (
    "id" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "dailyKg" INTEGER,
    "expressReservePct" INTEGER NOT NULL DEFAULT 20,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "commerce_capacity_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "commerce_fabric_risk_rules_fabric_key" ON "commerce_fabric_risk_rules"("fabric");

-- CreateIndex
CREATE INDEX "commerce_garment_pieces_orderId_idx" ON "commerce_garment_pieces"("orderId");

-- CreateIndex
CREATE INDEX "idx_piece_store_stage_due" ON "commerce_garment_pieces"("storeId", "stage", "dueAt");

-- CreateIndex
CREATE INDEX "commerce_garment_pieces_activeBatchId_idx" ON "commerce_garment_pieces"("activeBatchId");

-- CreateIndex
CREATE UNIQUE INDEX "commerce_garment_pieces_storeId_tagCode_key" ON "commerce_garment_pieces"("storeId", "tagCode");

-- CreateIndex
CREATE INDEX "idx_machine_store_state" ON "commerce_floor_machines"("storeId", "state");

-- CreateIndex
CREATE INDEX "idx_machine_store_type" ON "commerce_floor_machines"("storeId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "commerce_floor_machines_storeId_code_key" ON "commerce_floor_machines"("storeId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "uq_machine_check_day" ON "commerce_floor_machine_checks"("machineId", "checkDate");

-- CreateIndex
CREATE INDEX "idx_fault_machine_created" ON "commerce_floor_machine_faults"("machineId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "idx_fault_store_status" ON "commerce_floor_machine_faults"("storeId", "status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "idx_batch_store_status_due" ON "commerce_floor_batches"("storeId", "status", "dueAt");

-- CreateIndex
CREATE INDEX "idx_batch_store_service" ON "commerce_floor_batches"("storeId", "serviceId");

-- CreateIndex
CREATE INDEX "commerce_floor_batches_machineId_idx" ON "commerce_floor_batches"("machineId");

-- CreateIndex
CREATE INDEX "commerce_floor_batch_pieces_pieceId_idx" ON "commerce_floor_batch_pieces"("pieceId");

-- CreateIndex
CREATE UNIQUE INDEX "uq_batch_piece" ON "commerce_floor_batch_pieces"("batchId", "pieceId");

-- CreateIndex
CREATE INDEX "idx_qc_order_created" ON "commerce_quality_checks"("orderId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "commerce_quality_check_results_checkId_idx" ON "commerce_quality_check_results"("checkId");

-- CreateIndex
CREATE INDEX "commerce_quality_check_results_pieceId_idx" ON "commerce_quality_check_results"("pieceId");

-- CreateIndex
CREATE INDEX "idx_order_note_order_created" ON "commerce_order_notes"("orderId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "commerce_order_collections_orderId_key" ON "commerce_order_collections"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "uq_walkin_user_key" ON "commerce_walkin_requests"("userId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "commerce_capacity_settings_storeId_key" ON "commerce_capacity_settings"("storeId");

-- AddForeignKey
ALTER TABLE "commerce_garment_pieces" ADD CONSTRAINT "commerce_garment_pieces_activeBatchId_fkey" FOREIGN KEY ("activeBatchId") REFERENCES "commerce_floor_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commerce_floor_machine_checks" ADD CONSTRAINT "commerce_floor_machine_checks_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "commerce_floor_machines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commerce_floor_machine_faults" ADD CONSTRAINT "commerce_floor_machine_faults_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "commerce_floor_machines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commerce_floor_batches" ADD CONSTRAINT "commerce_floor_batches_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "commerce_floor_machines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commerce_floor_batch_pieces" ADD CONSTRAINT "commerce_floor_batch_pieces_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "commerce_floor_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commerce_floor_batch_pieces" ADD CONSTRAINT "commerce_floor_batch_pieces_pieceId_fkey" FOREIGN KEY ("pieceId") REFERENCES "commerce_garment_pieces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commerce_quality_check_results" ADD CONSTRAINT "commerce_quality_check_results_checkId_fkey" FOREIGN KEY ("checkId") REFERENCES "commerce_quality_checks"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Default fabric risk rules. Configuration, not demo data, so they ship with the schema; an
-- existing row is never overwritten.
INSERT INTO "commerce_fabric_risk_rules" ("id", "fabric", "risk", "handling", "washProgramme", "dryProgramme", "maxTemperatureC", "cycle", "updatedAt") VALUES
  (gen_random_uuid(), 'cotton',    'low',    'Machine wash. Test new or dark items for colour run.',                   'Warm cotton 40°C',         'Medium tumble', 40, 'normal',    now()),
  (gen_random_uuid(), 'linen',     'medium', 'Gentle wash; do not over-dry. Press while damp.',                        'Gentle 30°C',              'Low tumble',    30, 'gentle',    now()),
  (gen_random_uuid(), 'wool',      'high',   'Cool wool wash only. Never tumble dry; reshape and dry flat.',           'Wool cycle 20°C',          'Flat dry',      20, 'wool',      now()),
  (gen_random_uuid(), 'silk',      'high',   'Cold delicate wash, no wringing, no tumble dry.',                        'Delicate cold 20°C',       'Flat dry',      20, 'delicate',  now()),
  (gen_random_uuid(), 'synthetic', 'low',    'Cool to warm wash; low heat only.',                                      'Synthetic 30°C',           'Low tumble',    30, 'synthetic', now()),
  (gen_random_uuid(), 'blend',     'medium', 'Treat as the most delicate fibre in the blend.',                         'Gentle 30°C',              'Low tumble',    30, 'gentle',    now()),
  (gen_random_uuid(), 'denim',     'medium', 'Wash inside out in cool water to hold the colour.',                      'Cool denim 30°C',          'Medium tumble', 30, 'normal',    now()),
  (gen_random_uuid(), 'leather',   'high',   'Never machine wash. Send for specialist leather care.',                  'Specialist leather care',  'none',           0, 'none',      now()),
  (gen_random_uuid(), 'unknown',   'medium', 'Fabric not identified: handle as delicate until it is checked.',         'Gentle 30°C',              'Low tumble',    30, 'gentle',    now())
ON CONFLICT ("fabric") DO NOTHING;
