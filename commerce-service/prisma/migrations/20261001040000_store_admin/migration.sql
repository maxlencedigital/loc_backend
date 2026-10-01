-- P04 store admin: cash and day close, stock flags and ledger, resource readings, areas and the
-- global > area > store price hierarchy with its change history.

-- CreateTable
CREATE TABLE "commerce_store_days" (
    "id" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'open',
    "closedAt" TIMESTAMPTZ(6),
    "closedByUserId" TEXT,
    "closedByName" TEXT,
    "closeNote" TEXT,
    "closedExpectedPaise" INTEGER,
    "closedCountedPaise" INTEGER,
    "closedVariancePaise" INTEGER,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "commerce_store_days_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "chk_store_day_state" CHECK ("state" IN ('open', 'counted', 'closed'))
);

-- CreateTable
CREATE TABLE "commerce_cash_counts" (
    "id" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "countedPaise" INTEGER NOT NULL,
    "expectedPaise" INTEGER NOT NULL,
    "variancePaise" INTEGER NOT NULL,
    "denominations" JSONB,
    "note" TEXT,
    "countedByUserId" TEXT,
    "countedByName" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commerce_cash_counts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "chk_cash_count_counted" CHECK ("countedPaise" >= 0 AND "expectedPaise" >= 0)
);

-- CreateTable
CREATE TABLE "commerce_cash_deposits" (
    "id" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "bankReference" TEXT NOT NULL,
    "depositedAt" TIMESTAMPTZ(6) NOT NULL,
    "byUserId" TEXT,
    "byName" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commerce_cash_deposits_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "chk_cash_deposit_amount" CHECK ("amountPaise" > 0)
);

-- CreateTable
CREATE TABLE "commerce_cash_variances" (
    "id" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "countId" UUID NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "note" TEXT,
    "resolvedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "commerce_cash_variances_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "chk_cash_variance_status" CHECK ("status" IN ('open', 'explained', 'resolved'))
);

-- CreateTable
CREATE TABLE "commerce_stock_movements" (
    "id" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "deltaMilli" INTEGER NOT NULL,
    "quantityAfterMilli" INTEGER NOT NULL,
    "reason" TEXT,
    "byUserId" TEXT,
    "byName" TEXT NOT NULL,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commerce_stock_movements_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "chk_stock_movement_kind" CHECK ("kind" IN ('consumption', 'receipt', 'correction')),
    CONSTRAINT "chk_stock_movement_delta" CHECK ("deltaMilli" <> 0 AND "quantityAfterMilli" >= 0)
);

-- CreateTable
CREATE TABLE "commerce_stock_flags" (
    "id" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "level" TEXT NOT NULL,
    "note" TEXT,
    "raisedByUserId" TEXT,
    "raisedByName" TEXT NOT NULL,
    "raisedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commerce_stock_flags_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "chk_stock_flag_level" CHECK ("level" IN ('low', 'critical', 'out'))
);

-- CreateTable
CREATE TABLE "commerce_resource_readings" (
    "id" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "waterMilliLitres" INTEGER,
    "electricityMilliKwh" INTEGER,
    "detergentMilliKg" INTEGER,
    "notes" TEXT,
    "byUserId" TEXT,
    "byName" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commerce_resource_readings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "chk_resource_reading_any" CHECK (
        "waterMilliLitres" IS NOT NULL OR "electricityMilliKwh" IS NOT NULL OR "detergentMilliKg" IS NOT NULL
    )
);

-- CreateTable
CREATE TABLE "commerce_areas" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "city" TEXT NOT NULL DEFAULT '',
    "pincodes" TEXT[],
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "commerce_areas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce_area_members" (
    "id" UUID NOT NULL,
    "areaId" UUID NOT NULL,
    "storeId" UUID NOT NULL,

    CONSTRAINT "commerce_area_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce_price_overrides" (
    "id" UUID NOT NULL,
    "scope" TEXT NOT NULL,
    "scopeId" UUID NOT NULL,
    "serviceId" UUID NOT NULL,
    "garmentTypeId" UUID NOT NULL,
    "garment" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "ratePaise" INTEGER NOT NULL,
    "expressRatePaise" INTEGER NOT NULL,
    "updatedByName" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "commerce_price_overrides_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "chk_price_override_scope" CHECK ("scope" IN ('global', 'area', 'store')),
    CONSTRAINT "chk_price_override_rates" CHECK ("ratePaise" > 0 AND "expressRatePaise" >= "ratePaise")
);

-- CreateTable
CREATE TABLE "commerce_price_changes" (
    "id" UUID NOT NULL,
    "scope" TEXT NOT NULL,
    "scopeId" UUID NOT NULL,
    "serviceId" UUID NOT NULL,
    "garmentTypeId" UUID NOT NULL,
    "fromPaise" INTEGER,
    "toPaise" INTEGER,
    "byUserId" TEXT,
    "byName" TEXT NOT NULL,
    "at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commerce_price_changes_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "chk_price_change_scope" CHECK ("scope" IN ('global', 'area', 'store'))
);

-- CreateIndex
CREATE UNIQUE INDEX "uq_store_day" ON "commerce_store_days"("storeId", "date");

-- CreateIndex
CREATE INDEX "idx_cash_count_store_date" ON "commerce_cash_counts"("storeId", "date" DESC, "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "uq_cash_deposit_reference" ON "commerce_cash_deposits"("storeId", "bankReference");

-- CreateIndex
CREATE INDEX "idx_cash_deposit_store_deposited" ON "commerce_cash_deposits"("storeId", "depositedAt" DESC);

-- CreateIndex
CREATE INDEX "idx_cash_deposit_store_date" ON "commerce_cash_deposits"("storeId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "uq_cash_variance_count" ON "commerce_cash_variances"("countId");

-- CreateIndex
CREATE INDEX "idx_cash_variance_store_status" ON "commerce_cash_variances"("storeId", "status", "date" DESC);

-- CreateIndex
CREATE INDEX "idx_cash_variance_store_date" ON "commerce_cash_variances"("storeId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "uq_stock_movement_key" ON "commerce_stock_movements"("storeId", "itemId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "idx_stock_movement_item" ON "commerce_stock_movements"("storeId", "itemId", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "uq_stock_flag_item" ON "commerce_stock_flags"("storeId", "itemId");

-- CreateIndex
CREATE INDEX "idx_stock_flag_store_raised" ON "commerce_stock_flags"("storeId", "raisedAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "uq_resource_reading_day" ON "commerce_resource_readings"("storeId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "uq_store_area_name" ON "commerce_areas"("name");

-- CreateIndex
CREATE UNIQUE INDEX "uq_area_member_store" ON "commerce_area_members"("storeId");

-- CreateIndex
CREATE INDEX "idx_area_member_area" ON "commerce_area_members"("areaId");

-- CreateIndex
CREATE UNIQUE INDEX "uq_price_override_item" ON "commerce_price_overrides"("scope", "scopeId", "serviceId", "garmentTypeId");

-- CreateIndex
CREATE INDEX "idx_price_override_scope_service" ON "commerce_price_overrides"("scope", "serviceId");

-- CreateIndex
CREATE INDEX "idx_price_change_at" ON "commerce_price_changes"("at" DESC);

-- CreateIndex
CREATE INDEX "idx_price_change_scope" ON "commerce_price_changes"("scope", "scopeId", "at" DESC);

-- AddForeignKey
ALTER TABLE "commerce_area_members" ADD CONSTRAINT "commerce_area_members_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "commerce_areas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Pricing writes take this counter row's lock, so two admins changing prices cannot interleave
-- their old/new history. Added here, not lazily, so two first writes cannot race to create it.
INSERT INTO "commerce_sequence_counters" ("name", "value") VALUES ('pricing_write', 0)
ON CONFLICT ("name") DO NOTHING;
