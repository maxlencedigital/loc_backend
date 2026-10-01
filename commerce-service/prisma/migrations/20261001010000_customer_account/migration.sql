-- P01 customer account: profiles, addresses, garment profiles, photos, pickup slots,
-- app-order details and paid totals.

-- CreateTable
CREATE TABLE "commerce_customer_profiles" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "defaultAddressId" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "commerce_customer_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce_customer_addresses" (
    "id" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "line1" TEXT NOT NULL,
    "line2" TEXT NOT NULL DEFAULT '',
    "landmark" TEXT NOT NULL DEFAULT '',
    "city" TEXT NOT NULL,
    "pincode" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "commerce_customer_addresses_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "chk_customer_address_label" CHECK ("label" IN ('home', 'office', 'other'))
);

-- CreateTable
CREATE TABLE "commerce_customer_garment_profiles" (
    "id" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "garmentTypeId" UUID,
    "fabric" TEXT NOT NULL DEFAULT 'unknown',
    "colour" TEXT NOT NULL DEFAULT '',
    "brand" TEXT NOT NULL DEFAULT '',
    "washInstructions" TEXT[],
    "avoid" TEXT[],
    "notes" TEXT NOT NULL DEFAULT '',
    "isFavourite" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "commerce_customer_garment_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce_customer_photos" (
    "id" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "ownerType" TEXT NOT NULL,
    "ownerId" UUID NOT NULL,
    "itemId" UUID,
    "url" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commerce_customer_photos_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "chk_customer_photo_owner" CHECK ("ownerType" IN ('order', 'garment_profile'))
);

-- CreateTable
CREATE TABLE "commerce_pickup_slot_configs" (
    "id" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "slotMinutes" INTEGER NOT NULL DEFAULT 120,
    "capacityPerSlot" INTEGER NOT NULL DEFAULT 8,
    "leadMinutes" INTEGER NOT NULL DEFAULT 120,
    "horizonDays" INTEGER NOT NULL DEFAULT 7,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "commerce_pickup_slot_configs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "chk_pickup_slot_config_bounds" CHECK (
        "slotMinutes" BETWEEN 30 AND 480 AND "capacityPerSlot" BETWEEN 1 AND 500
        AND "leadMinutes" BETWEEN 0 AND 2880 AND "horizonDays" BETWEEN 1 AND 30
    )
);

-- CreateTable
CREATE TABLE "commerce_pickup_slots" (
    "id" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "startsAt" TIMESTAMPTZ(6) NOT NULL,
    "endsAt" TIMESTAMPTZ(6) NOT NULL,
    "capacity" INTEGER NOT NULL,
    "booked" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commerce_pickup_slots_pkey" PRIMARY KEY ("id"),
    -- A second line of defence under the conditional UPDATE: the count can never exceed the seats.
    CONSTRAINT "chk_pickup_slot_booked" CHECK ("booked" >= 0 AND "booked" <= "capacity")
);

-- CreateTable
CREATE TABLE "commerce_customer_orders" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "idempotencyKey" TEXT,
    "pickupSlotId" UUID NOT NULL,
    "pickupFrom" TIMESTAMPTZ(6) NOT NULL,
    "pickupTo" TIMESTAMPTZ(6) NOT NULL,
    "pickupAddressId" UUID,
    "pickupAddress" TEXT NOT NULL,
    "deliveryAddressId" UUID,
    "deliveryAddress" TEXT NOT NULL,
    "paymentMethod" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commerce_customer_orders_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "chk_customer_order_payment_method" CHECK ("paymentMethod" IN ('online', 'cash_on_delivery'))
);

-- CreateTable
CREATE TABLE "commerce_customer_order_lines" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "orderItemId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "garmentTypeId" UUID NOT NULL,
    "garmentProfileId" UUID,
    "fabric" TEXT NOT NULL DEFAULT 'unknown',
    "note" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commerce_customer_order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce_order_paid_totals" (
    "orderId" UUID NOT NULL,
    "paidPaise" INTEGER NOT NULL,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "commerce_order_paid_totals_pkey" PRIMARY KEY ("orderId"),
    CONSTRAINT "chk_order_paid_total_positive" CHECK ("paidPaise" >= 0)
);

-- CreateIndex
CREATE UNIQUE INDEX "uq_customer_profile_user" ON "commerce_customer_profiles"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "uq_customer_profile_customer" ON "commerce_customer_profiles"("customerId");

-- CreateIndex
CREATE INDEX "idx_customer_address_owner" ON "commerce_customer_addresses"("customerId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "idx_garment_profile_owner" ON "commerce_customer_garment_profiles"("customerId", "isFavourite" DESC, "createdAt" DESC);

-- CreateIndex
CREATE INDEX "idx_customer_photo_owner" ON "commerce_customer_photos"("ownerType", "ownerId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "uq_pickup_slot_config_store" ON "commerce_pickup_slot_configs"("storeId");

-- CreateIndex
CREATE UNIQUE INDEX "uq_pickup_slot_window" ON "commerce_pickup_slots"("storeId", "startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "uq_customer_order_order" ON "commerce_customer_orders"("orderId");

-- CreateIndex
CREATE INDEX "idx_customer_order_slot" ON "commerce_customer_orders"("pickupSlotId");

-- CreateIndex
CREATE UNIQUE INDEX "uq_customer_order_idempotency" ON "commerce_customer_orders"("customerId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "uq_customer_order_line_item" ON "commerce_customer_order_lines"("orderItemId");

-- CreateIndex
CREATE INDEX "idx_customer_order_line_order" ON "commerce_customer_order_lines"("orderId");

-- CreateIndex
CREATE INDEX "idx_customer_order_line_profile" ON "commerce_customer_order_lines"("garmentProfileId", "createdAt" DESC);
