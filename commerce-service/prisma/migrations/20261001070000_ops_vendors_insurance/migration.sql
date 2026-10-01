-- P07: vendors, purchasing and insurance.

-- CreateEnum
CREATE TYPE "OpsVendorCategory" AS ENUM ('detergent', 'packaging', 'machinery', 'spares', 'it', 'services', 'other');

-- CreateEnum
CREATE TYPE "OpsMaterialCategory" AS ENUM ('detergent', 'softener', 'packaging', 'hangers', 'chemicals', 'other');

-- CreateEnum
CREATE TYPE "OpsPurchaseOrderStatus" AS ENUM ('draft', 'sent', 'partially_received', 'received', 'cancelled');

-- CreateEnum
CREATE TYPE "OpsPolicyType" AS ENUM ('property', 'equipment', 'public_liability', 'rider_vehicle', 'staff_medical', 'staff_accident', 'other');

-- CreateEnum
CREATE TYPE "OpsClaimStatus" AS ENUM ('raised', 'submitted', 'under_review', 'settled', 'rejected');

-- CreateEnum
CREATE TYPE "OpsClaimOutcome" AS ENUM ('paid', 'partially_paid', 'rejected');

-- CreateTable
CREATE TABLE "commerce_vendors" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "category" "OpsVendorCategory" NOT NULL DEFAULT 'other',
    "contactName" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "gstin" TEXT,
    "paymentTerms" TEXT,
    "bankAccountLast4" TEXT,
    "bankIfsc" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "deactivatedAt" TIMESTAMPTZ(6),
    "deactivationReason" TEXT,
    "deactivatedBy" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "commerce_vendors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce_vendor_agreements" (
    "id" UUID NOT NULL,
    "vendorId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "terms" TEXT,
    "documents" JSONB NOT NULL DEFAULT '[]',
    "createdBy" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "commerce_vendor_agreements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce_materials" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "category" "OpsMaterialCategory" NOT NULL DEFAULT 'other',
    "unit" TEXT NOT NULL,
    "reorderLevelMilli" INTEGER NOT NULL DEFAULT 0,
    "preferredVendorId" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "commerce_materials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce_material_stock" (
    "materialId" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "quantityMilli" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "commerce_material_stock_pkey" PRIMARY KEY ("materialId","storeId")
);

-- CreateTable
CREATE TABLE "commerce_purchase_orders" (
    "id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "vendorId" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "status" "OpsPurchaseOrderStatus" NOT NULL DEFAULT 'draft',
    "totalPaise" INTEGER NOT NULL DEFAULT 0,
    "receivedValuePaise" INTEGER NOT NULL DEFAULT 0,
    "expectedOn" DATE,
    "notes" TEXT,
    "sentAt" TIMESTAMPTZ(6),
    "receivedAt" TIMESTAMPTZ(6),
    "deliveredOnTime" BOOLEAN,
    "cancelledAt" TIMESTAMPTZ(6),
    "cancelReason" TEXT,
    "createdBy" TEXT NOT NULL,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "commerce_purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce_purchase_order_items" (
    "id" UUID NOT NULL,
    "purchaseOrderId" UUID NOT NULL,
    "materialId" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "materialName" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "quantityMilli" INTEGER NOT NULL,
    "receivedMilli" INTEGER NOT NULL DEFAULT 0,
    "unitPricePaise" INTEGER,
    "amountPaise" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "commerce_purchase_order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce_purchase_order_events" (
    "id" UUID NOT NULL,
    "purchaseOrderId" UUID NOT NULL,
    "fromStatus" "OpsPurchaseOrderStatus",
    "toStatus" "OpsPurchaseOrderStatus" NOT NULL,
    "note" TEXT,
    "byUserId" TEXT NOT NULL,
    "byName" TEXT NOT NULL,
    "at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commerce_purchase_order_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce_purchase_order_receipts" (
    "id" UUID NOT NULL,
    "purchaseOrderId" UUID NOT NULL,
    "invoiceRef" TEXT,
    "note" TEXT,
    "lines" JSONB NOT NULL,
    "byUserId" TEXT NOT NULL,
    "byName" TEXT NOT NULL,
    "receivedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commerce_purchase_order_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce_insurance_policies" (
    "id" UUID NOT NULL,
    "type" "OpsPolicyType" NOT NULL,
    "insurer" TEXT NOT NULL,
    "insurerKey" TEXT NOT NULL,
    "policyNumber" TEXT NOT NULL,
    "coverageAmountPaise" BIGINT,
    "premiumPaise" BIGINT,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "covers" TEXT,
    "storeIds" UUID[],
    "employeeIds" UUID[],
    "cancelledAt" TIMESTAMPTZ(6),
    "cancelReason" TEXT,
    "documents" JSONB NOT NULL DEFAULT '[]',
    "createdBy" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "commerce_insurance_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce_insurance_policy_renewals" (
    "id" UUID NOT NULL,
    "policyId" UUID NOT NULL,
    "previousEndDate" DATE NOT NULL,
    "newEndDate" DATE NOT NULL,
    "previousPolicyNumber" TEXT NOT NULL,
    "newPolicyNumber" TEXT NOT NULL,
    "previousPremiumPaise" BIGINT,
    "newPremiumPaise" BIGINT,
    "byUserId" TEXT NOT NULL,
    "byName" TEXT NOT NULL,
    "at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commerce_insurance_policy_renewals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce_insurance_claims" (
    "id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "policyId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "incidentDate" DATE NOT NULL,
    "claimAmountPaise" BIGINT NOT NULL,
    "incidentId" UUID,
    "storeId" UUID,
    "employeeId" UUID,
    "orderId" UUID,
    "status" "OpsClaimStatus" NOT NULL DEFAULT 'raised',
    "insurerReference" TEXT,
    "outcome" "OpsClaimOutcome",
    "settledAmountPaise" BIGINT,
    "settledAt" TIMESTAMPTZ(6),
    "decisionSeconds" INTEGER,
    "documents" JSONB NOT NULL DEFAULT '[]',
    "raisedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL,
    "idempotencyKey" TEXT,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "commerce_insurance_claims_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce_insurance_claim_events" (
    "id" UUID NOT NULL,
    "claimId" UUID NOT NULL,
    "fromStatus" "OpsClaimStatus",
    "toStatus" "OpsClaimStatus" NOT NULL,
    "note" TEXT,
    "byUserId" TEXT NOT NULL,
    "byName" TEXT NOT NULL,
    "at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commerce_insurance_claim_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "commerce_vendors_gstin_key" ON "commerce_vendors"("gstin");

-- CreateIndex
CREATE INDEX "idx_ops_vendor_active_name" ON "commerce_vendors"("isActive", "name");

-- CreateIndex
CREATE INDEX "idx_ops_vendor_category_name" ON "commerce_vendors"("category", "name");

-- CreateIndex
CREATE INDEX "idx_ops_agreement_vendor_start" ON "commerce_vendor_agreements"("vendorId", "startDate" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "commerce_materials_name_key" ON "commerce_materials"("name");

-- CreateIndex
CREATE INDEX "idx_ops_material_category_name" ON "commerce_materials"("category", "name");

-- CreateIndex
CREATE INDEX "idx_ops_material_vendor" ON "commerce_materials"("preferredVendorId");

-- CreateIndex
CREATE INDEX "idx_ops_stock_store" ON "commerce_material_stock"("storeId");

-- CreateIndex
CREATE UNIQUE INDEX "commerce_purchase_orders_number_key" ON "commerce_purchase_orders"("number");

-- CreateIndex
CREATE INDEX "idx_ops_po_store_status_created" ON "commerce_purchase_orders"("storeId", "status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "idx_ops_po_vendor_created" ON "commerce_purchase_orders"("vendorId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "idx_ops_po_status_created" ON "commerce_purchase_orders"("status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "idx_ops_po_created" ON "commerce_purchase_orders"("createdAt" DESC);

-- CreateIndex
CREATE INDEX "idx_ops_po_vendor_sent" ON "commerce_purchase_orders"("vendorId", "sentAt");

-- CreateIndex
CREATE INDEX "idx_ops_po_sent" ON "commerce_purchase_orders"("sentAt");

-- CreateIndex
CREATE UNIQUE INDEX "uq_ops_po_idempotency" ON "commerce_purchase_orders"("createdBy", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "uq_ops_po_item_material" ON "commerce_purchase_order_items"("purchaseOrderId", "materialId");

-- CreateIndex
CREATE INDEX "idx_ops_po_item_order" ON "commerce_purchase_order_items"("purchaseOrderId", "position");

-- CreateIndex
CREATE INDEX "idx_ops_po_item_store_material" ON "commerce_purchase_order_items"("storeId", "materialId");

-- CreateIndex
CREATE INDEX "idx_ops_po_item_material" ON "commerce_purchase_order_items"("materialId");

-- CreateIndex
CREATE INDEX "idx_ops_po_event_order_at" ON "commerce_purchase_order_events"("purchaseOrderId", "at");

-- CreateIndex
CREATE INDEX "idx_ops_po_receipt_order_at" ON "commerce_purchase_order_receipts"("purchaseOrderId", "receivedAt");

-- CreateIndex
CREATE INDEX "idx_ops_policy_cancelled_end" ON "commerce_insurance_policies"("cancelledAt", "endDate");

-- CreateIndex
CREATE INDEX "idx_ops_policy_type_end" ON "commerce_insurance_policies"("type", "endDate");

-- CreateIndex
CREATE INDEX "idx_ops_policy_stores" ON "commerce_insurance_policies" USING GIN ("storeIds");

-- CreateIndex
CREATE INDEX "idx_ops_policy_employees" ON "commerce_insurance_policies" USING GIN ("employeeIds");

-- CreateIndex
CREATE UNIQUE INDEX "uq_ops_policy_insurer_number" ON "commerce_insurance_policies"("insurerKey", "policyNumber");

-- CreateIndex
CREATE INDEX "idx_ops_renewal_policy_at" ON "commerce_insurance_policy_renewals"("policyId", "at");

-- CreateIndex
CREATE UNIQUE INDEX "commerce_insurance_claims_number_key" ON "commerce_insurance_claims"("number");

-- CreateIndex
CREATE INDEX "idx_ops_claim_raised" ON "commerce_insurance_claims"("raisedAt" DESC);

-- CreateIndex
CREATE INDEX "idx_ops_claim_status_raised" ON "commerce_insurance_claims"("status", "raisedAt" DESC);

-- CreateIndex
CREATE INDEX "idx_ops_claim_policy_raised" ON "commerce_insurance_claims"("policyId", "raisedAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "uq_ops_claim_idempotency" ON "commerce_insurance_claims"("createdBy", "idempotencyKey");

-- CreateIndex
CREATE INDEX "idx_ops_claim_event_claim_at" ON "commerce_insurance_claim_events"("claimId", "at");

-- AddForeignKey
ALTER TABLE "commerce_vendor_agreements" ADD CONSTRAINT "commerce_vendor_agreements_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "commerce_vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commerce_materials" ADD CONSTRAINT "commerce_materials_preferredVendorId_fkey" FOREIGN KEY ("preferredVendorId") REFERENCES "commerce_vendors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commerce_material_stock" ADD CONSTRAINT "commerce_material_stock_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "commerce_materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commerce_purchase_orders" ADD CONSTRAINT "commerce_purchase_orders_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "commerce_vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commerce_purchase_order_items" ADD CONSTRAINT "commerce_purchase_order_items_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "commerce_purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commerce_purchase_order_items" ADD CONSTRAINT "commerce_purchase_order_items_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "commerce_materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commerce_purchase_order_events" ADD CONSTRAINT "commerce_purchase_order_events_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "commerce_purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commerce_purchase_order_receipts" ADD CONSTRAINT "commerce_purchase_order_receipts_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "commerce_purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commerce_insurance_policy_renewals" ADD CONSTRAINT "commerce_insurance_policy_renewals_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "commerce_insurance_policies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commerce_insurance_claims" ADD CONSTRAINT "commerce_insurance_claims_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "commerce_insurance_policies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commerce_insurance_claim_events" ADD CONSTRAINT "commerce_insurance_claim_events_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "commerce_insurance_claims"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Guards the service also checks, so a bug or a manual write cannot leave a nonsensical row.
ALTER TABLE "commerce_purchase_order_items" ADD CONSTRAINT "ck_ops_po_item_quantities" CHECK ("quantityMilli" > 0 AND "receivedMilli" >= 0 AND "receivedMilli" <= "quantityMilli");
ALTER TABLE "commerce_purchase_orders" ADD CONSTRAINT "ck_ops_po_amounts" CHECK ("totalPaise" >= 0 AND "receivedValuePaise" >= 0 AND "receivedValuePaise" <= "totalPaise");
ALTER TABLE "commerce_material_stock" ADD CONSTRAINT "ck_ops_stock_quantity" CHECK ("quantityMilli" >= 0);
ALTER TABLE "commerce_vendor_agreements" ADD CONSTRAINT "ck_ops_agreement_dates" CHECK ("endDate" IS NULL OR "endDate" >= "startDate");
ALTER TABLE "commerce_insurance_policies" ADD CONSTRAINT "ck_ops_policy_dates" CHECK ("endDate" >= "startDate");
ALTER TABLE "commerce_insurance_claims" ADD CONSTRAINT "ck_ops_claim_amounts" CHECK ("claimAmountPaise" > 0 AND ("settledAmountPaise" IS NULL OR "settledAmountPaise" >= 0));

-- Numbering for purchase orders (PO-1001...) and claims (CLM-1001...).
INSERT INTO "commerce_sequence_counters" ("name", "value") VALUES ('purchase_order_ref', 1000), ('insurance_claim_ref', 1000)
ON CONFLICT ("name") DO NOTHING;
