-- CreateEnum
CREATE TYPE "ComplaintType" AS ENUM ('damaged_item', 'late_delivery', 'wrong_charge', 'missing_item', 'quality', 'rider_behaviour', 'other');

-- CreateEnum
CREATE TYPE "ComplaintSeverity" AS ENUM ('low', 'medium', 'high');

-- CreateEnum
CREATE TYPE "ComplaintStatus" AS ENUM ('open', 'assigned', 'in_progress', 'resolved', 'escalated', 'closed');

-- CreateEnum
CREATE TYPE "ComplaintDecision" AS ENUM ('refund', 'goodwill', 'reject', 'policy_exception');

-- CreateEnum
CREATE TYPE "ComplaintSource" AS ENUM ('customer', 'store');

-- CreateEnum
CREATE TYPE "ComplaintEventKind" AS ENUM ('created', 'comment', 'assigned', 'escalated', 'resolved', 'reopened', 'closed', 'photos_added');

-- CreateEnum
CREATE TYPE "ComplaintActor" AS ENUM ('customer', 'staff', 'system');

-- CreateEnum
CREATE TYPE "SupportTicketStatus" AS ENUM ('open', 'answered', 'closed');

-- CreateEnum
CREATE TYPE "SupportMessageAuthor" AS ENUM ('customer', 'support');

-- CreateEnum
CREATE TYPE "CustomerPaymentStatus" AS ENUM ('created', 'authorized', 'captured', 'failed');

-- CreateEnum
CREATE TYPE "SavedPaymentMethodType" AS ENUM ('card', 'upi');

-- CreateTable
CREATE TABLE "commerce_complaints" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "orderRef" TEXT NOT NULL,
    "storeId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "customerUserId" UUID,
    "source" "ComplaintSource" NOT NULL,
    "type" "ComplaintType" NOT NULL,
    "severity" "ComplaintSeverity" NOT NULL DEFAULT 'medium',
    "description" TEXT NOT NULL,
    "itemId" UUID,
    "status" "ComplaintStatus" NOT NULL DEFAULT 'open',
    "activeKey" TEXT,
    "assigneeId" UUID,
    "assigneeName" TEXT,
    "assignedAt" TIMESTAMPTZ(6),
    "firstResponseAt" TIMESTAMPTZ(6),
    "resolvedAt" TIMESTAMPTZ(6),
    "closedAt" TIMESTAMPTZ(6),
    "escalatedAt" TIMESTAMPTZ(6),
    "escalationReason" TEXT,
    "decision" "ComplaintDecision",
    "resolution" TEXT,
    "refundAmountPaise" INTEGER,
    "goodwill" TEXT,
    "photos" JSONB NOT NULL DEFAULT '[]',
    "reopenCount" INTEGER NOT NULL DEFAULT 0,
    "createdByUserId" UUID NOT NULL,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "commerce_complaints_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "chk_complaint_refund_nonnegative" CHECK ("refundAmountPaise" IS NULL OR "refundAmountPaise" >= 0)
);

-- CreateTable
CREATE TABLE "commerce_complaint_events" (
    "id" UUID NOT NULL,
    "complaintId" UUID NOT NULL,
    "kind" "ComplaintEventKind" NOT NULL,
    "actorRole" "ComplaintActor" NOT NULL,
    "actorUserId" UUID,
    "actorName" TEXT NOT NULL,
    "message" TEXT,
    "internal" BOOLEAN NOT NULL DEFAULT false,
    "fromStatus" "ComplaintStatus",
    "toStatus" "ComplaintStatus",
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commerce_complaint_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce_support_tickets" (
    "id" UUID NOT NULL,
    "customerUserId" UUID NOT NULL,
    "subject" TEXT NOT NULL,
    "status" "SupportTicketStatus" NOT NULL DEFAULT 'open',
    "orderId" UUID,
    "storeId" UUID,
    "messageCount" INTEGER NOT NULL DEFAULT 0,
    "firstResponseAt" TIMESTAMPTZ(6),
    "answeredAt" TIMESTAMPTZ(6),
    "closedAt" TIMESTAMPTZ(6),
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "commerce_support_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce_support_ticket_messages" (
    "id" UUID NOT NULL,
    "ticketId" UUID NOT NULL,
    "author" "SupportMessageAuthor" NOT NULL,
    "authorUserId" UUID,
    "authorName" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commerce_support_ticket_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce_order_feedback" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "customerUserId" UUID NOT NULL,
    "rating" INTEGER NOT NULL,
    "storeRating" INTEGER,
    "riderRating" INTEGER,
    "riderId" UUID,
    "comment" TEXT,
    "ratedOn" DATE NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commerce_order_feedback_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "chk_feedback_rating" CHECK ("rating" BETWEEN 1 AND 5),
    CONSTRAINT "chk_feedback_store_rating" CHECK ("storeRating" IS NULL OR "storeRating" BETWEEN 1 AND 5),
    CONSTRAINT "chk_feedback_rider_rating" CHECK ("riderRating" IS NULL OR "riderRating" BETWEEN 1 AND 5)
);

-- CreateTable
CREATE TABLE "commerce_customer_payments" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "orderRef" TEXT NOT NULL,
    "customerUserId" UUID NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "method" TEXT,
    "status" "CustomerPaymentStatus" NOT NULL DEFAULT 'created',
    "financePaymentId" TEXT,
    "razorpayOrderId" TEXT NOT NULL,
    "razorpayPaymentId" TEXT,
    "keyId" TEXT NOT NULL,
    "idempotencyKey" TEXT,
    "paidAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "commerce_customer_payments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "chk_customer_payment_amount" CHECK ("amountPaise" > 0)
);

-- CreateTable
CREATE TABLE "commerce_saved_payment_methods" (
    "id" UUID NOT NULL,
    "customerUserId" UUID NOT NULL,
    "type" "SavedPaymentMethodType" NOT NULL,
    "providerToken" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "brand" TEXT,
    "last4" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "defaultKey" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commerce_saved_payment_methods_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "uq_complaint_active_key" ON "commerce_complaints"("activeKey");

-- CreateIndex
CREATE INDEX "idx_complaint_store_created" ON "commerce_complaints"("storeId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "idx_complaint_store_status_created" ON "commerce_complaints"("storeId", "status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "idx_complaint_status_created" ON "commerce_complaints"("status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "idx_complaint_created" ON "commerce_complaints"("createdAt" DESC);

-- CreateIndex
CREATE INDEX "idx_complaint_type_created" ON "commerce_complaints"("type", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "idx_complaint_assignee_created" ON "commerce_complaints"("assigneeId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "idx_complaint_customer_created" ON "commerce_complaints"("customerUserId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "idx_complaint_customer_status_created" ON "commerce_complaints"("customerUserId", "status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "idx_complaint_order" ON "commerce_complaints"("orderId");

-- CreateIndex
CREATE INDEX "idx_complaint_status_escalated" ON "commerce_complaints"("status", "escalatedAt" DESC);

-- CreateIndex
CREATE INDEX "idx_complaint_store_escalated" ON "commerce_complaints"("storeId", "escalatedAt" DESC);

-- CreateIndex
CREATE INDEX "idx_complaint_status_resolved" ON "commerce_complaints"("status", "resolvedAt");

-- CreateIndex
CREATE UNIQUE INDEX "uq_complaint_creator_key" ON "commerce_complaints"("createdByUserId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "idx_complaint_event_complaint_created" ON "commerce_complaint_events"("complaintId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "uq_ticket_customer_key" ON "commerce_support_tickets"("customerUserId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "idx_ticket_customer_updated" ON "commerce_support_tickets"("customerUserId", "updatedAt" DESC);

-- CreateIndex
CREATE INDEX "idx_ticket_customer_status_updated" ON "commerce_support_tickets"("customerUserId", "status", "updatedAt" DESC);

-- CreateIndex
CREATE INDEX "idx_ticket_message_ticket_created" ON "commerce_support_ticket_messages"("ticketId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "uq_feedback_order_customer" ON "commerce_order_feedback"("orderId", "customerUserId");

-- CreateIndex
CREATE INDEX "idx_feedback_store_created" ON "commerce_order_feedback"("storeId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "idx_feedback_rider_created" ON "commerce_order_feedback"("riderId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "idx_feedback_rating_created" ON "commerce_order_feedback"("rating", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "idx_feedback_created" ON "commerce_order_feedback"("createdAt" DESC);

-- CreateIndex
CREATE INDEX "idx_feedback_rated_on" ON "commerce_order_feedback"("ratedOn");

-- CreateIndex
CREATE UNIQUE INDEX "uq_customer_payment_razorpay_order" ON "commerce_customer_payments"("razorpayOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "uq_customer_payment_key" ON "commerce_customer_payments"("customerUserId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "idx_customer_payment_customer_created" ON "commerce_customer_payments"("customerUserId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "idx_customer_payment_order_status" ON "commerce_customer_payments"("orderId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "uq_saved_method_default" ON "commerce_saved_payment_methods"("defaultKey");

-- CreateIndex
CREATE UNIQUE INDEX "uq_saved_method_token" ON "commerce_saved_payment_methods"("customerUserId", "providerToken");

-- CreateIndex
CREATE INDEX "idx_saved_method_customer_created" ON "commerce_saved_payment_methods"("customerUserId", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "commerce_complaint_events" ADD CONSTRAINT "commerce_complaint_events_complaintId_fkey" FOREIGN KEY ("complaintId") REFERENCES "commerce_complaints"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commerce_support_ticket_messages" ADD CONSTRAINT "commerce_support_ticket_messages_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "commerce_support_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
