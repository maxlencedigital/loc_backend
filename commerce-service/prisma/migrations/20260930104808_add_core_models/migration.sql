-- CreateEnum
CREATE TYPE "StoreStatus" AS ENUM ('live', 'planned', 'closed');

-- CreateEnum
CREATE TYPE "StoreType" AS ENUM ('processing', 'pickup_hub', 'franchise');

-- CreateEnum
CREATE TYPE "CustomerType" AS ENUM ('retail', 'corporate');

-- CreateEnum
CREATE TYPE "ServiceDepartment" AS ENUM ('laundry', 'dry_clean', 'finishing', 'household', 'premium', 'specialty');

-- CreateEnum
CREATE TYPE "ServiceUnit" AS ENUM ('kg', 'piece', 'pair');

-- CreateEnum
CREATE TYPE "GarmentCategory" AS ENUM ('men', 'women', 'kids', 'household', 'premium');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('booked', 'picked_up', 'received', 'sorted', 'washing', 'drying', 'quality_check', 'packed', 'out_for_delivery', 'delivered', 'cancelled');

-- CreateEnum
CREATE TYPE "OrderPriority" AS ENUM ('standard', 'express');

-- CreateEnum
CREATE TYPE "OrderPaymentStatus" AS ENUM ('paid', 'unpaid', 'part_paid');

-- CreateEnum
CREATE TYPE "OrderChannel" AS ENUM ('app', 'walk_in', 'web', 'phone');

-- CreateTable
CREATE TABLE "commerce_stores" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "status" "StoreStatus" NOT NULL DEFAULT 'live',
    "type" "StoreType" NOT NULL,
    "openingHours" TEXT NOT NULL,
    "capacityKgPerDay" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "commerce_stores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce_customers" (
    "id" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT NOT NULL DEFAULT '',
    "type" "CustomerType" NOT NULL DEFAULT 'retail',
    "orderCount" INTEGER NOT NULL DEFAULT 0,
    "lifetimeValuePaise" INTEGER NOT NULL DEFAULT 0,
    "lastOrderAt" TIMESTAMPTZ(6),
    "churnRisk" INTEGER NOT NULL DEFAULT 0,
    "rating" DOUBLE PRECISION,
    "addresses" TEXT[],
    "walletBalancePaise" INTEGER NOT NULL DEFAULT 0,
    "loyaltyPoints" INTEGER NOT NULL DEFAULT 0,
    "tags" TEXT[],
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "commerce_customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce_services" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "department" "ServiceDepartment" NOT NULL,
    "unit" "ServiceUnit" NOT NULL,
    "turnaroundHours" INTEGER NOT NULL,
    "expressAvailable" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "commerce_services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce_price_lists" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "appliesTo" TEXT NOT NULL DEFAULT '',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "storeId" UUID,
    "customerType" "CustomerType",
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "commerce_price_lists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce_price_rows" (
    "id" UUID NOT NULL,
    "priceListId" UUID NOT NULL,
    "serviceId" UUID NOT NULL,
    "garment" TEXT NOT NULL,
    "category" "GarmentCategory" NOT NULL,
    "ratePaise" INTEGER NOT NULL,
    "expressRatePaise" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "commerce_price_rows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce_orders" (
    "id" UUID NOT NULL,
    "ref" TEXT NOT NULL,
    "storeId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'booked',
    "priority" "OrderPriority" NOT NULL DEFAULT 'standard',
    "paymentStatus" "OrderPaymentStatus" NOT NULL DEFAULT 'unpaid',
    "channel" "OrderChannel" NOT NULL DEFAULT 'walk_in',
    "pieces" INTEGER NOT NULL,
    "weightGrams" INTEGER NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "placedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "promisedAt" TIMESTAMPTZ(6) NOT NULL,
    "care" JSONB NOT NULL,
    "riderName" TEXT,
    "address" TEXT NOT NULL DEFAULT '',
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "commerce_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce_order_items" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "serviceId" UUID NOT NULL,
    "serviceName" TEXT NOT NULL,
    "garment" TEXT NOT NULL,
    "category" "GarmentCategory" NOT NULL,
    "unit" "ServiceUnit" NOT NULL,
    "quantityMilli" INTEGER NOT NULL,
    "ratePaise" INTEGER NOT NULL,
    "amountPaise" INTEGER NOT NULL,

    CONSTRAINT "commerce_order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce_order_events" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "status" "OrderStatus" NOT NULL,
    "byName" TEXT NOT NULL,
    "byUserId" TEXT,
    "note" TEXT,
    "at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commerce_order_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce_sequence_counters" (
    "name" TEXT NOT NULL,
    "value" INTEGER NOT NULL,

    CONSTRAINT "commerce_sequence_counters_pkey" PRIMARY KEY ("name")
);

-- CreateIndex
CREATE UNIQUE INDEX "commerce_stores_code_key" ON "commerce_stores"("code");

-- CreateIndex
CREATE UNIQUE INDEX "commerce_customers_phone_key" ON "commerce_customers"("phone");

-- CreateIndex
CREATE INDEX "idx_customer_store_created" ON "commerce_customers"("storeId", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "commerce_services_code_key" ON "commerce_services"("code");

-- CreateIndex
CREATE UNIQUE INDEX "commerce_price_lists_name_key" ON "commerce_price_lists"("name");

-- CreateIndex
CREATE INDEX "idx_price_list_active" ON "commerce_price_lists"("active");

-- CreateIndex
CREATE INDEX "idx_price_row_service" ON "commerce_price_rows"("serviceId");

-- CreateIndex
CREATE UNIQUE INDEX "uq_price_row_item" ON "commerce_price_rows"("priceListId", "serviceId", "garment", "category");

-- CreateIndex
CREATE UNIQUE INDEX "commerce_orders_ref_key" ON "commerce_orders"("ref");

-- CreateIndex
CREATE INDEX "idx_order_store_placed" ON "commerce_orders"("storeId", "placedAt" DESC);

-- CreateIndex
CREATE INDEX "idx_order_store_status" ON "commerce_orders"("storeId", "status");

-- CreateIndex
CREATE INDEX "idx_order_customer" ON "commerce_orders"("customerId");

-- CreateIndex
CREATE INDEX "idx_order_placed" ON "commerce_orders"("placedAt" DESC);

-- CreateIndex
CREATE INDEX "idx_order_item_order" ON "commerce_order_items"("orderId", "position");

-- CreateIndex
CREATE INDEX "idx_order_event_order_at" ON "commerce_order_events"("orderId", "at");

-- AddForeignKey
ALTER TABLE "commerce_customers" ADD CONSTRAINT "commerce_customers_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "commerce_stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commerce_price_lists" ADD CONSTRAINT "commerce_price_lists_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "commerce_stores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commerce_price_rows" ADD CONSTRAINT "commerce_price_rows_priceListId_fkey" FOREIGN KEY ("priceListId") REFERENCES "commerce_price_lists"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commerce_price_rows" ADD CONSTRAINT "commerce_price_rows_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "commerce_services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commerce_orders" ADD CONSTRAINT "commerce_orders_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "commerce_stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commerce_orders" ADD CONSTRAINT "commerce_orders_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "commerce_customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commerce_order_items" ADD CONSTRAINT "commerce_order_items_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "commerce_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commerce_order_events" ADD CONSTRAINT "commerce_order_events_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "commerce_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Seeds the order-reference counter: the first booking is LOC-24800. Done here,
-- not lazily in code, so two first bookings cannot race to create the row.
INSERT INTO "commerce_sequence_counters" ("name", "value") VALUES ('order_ref', 24799);
