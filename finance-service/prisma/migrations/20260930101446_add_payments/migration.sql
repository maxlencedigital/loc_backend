-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('created', 'authorized', 'captured', 'failed', 'refunded');

-- CreateTable
CREATE TABLE "finance_payments" (
    "id" TEXT NOT NULL,
    "orderRef" TEXT NOT NULL,
    "razorpayOrderId" TEXT NOT NULL,
    "razorpayPaymentId" TEXT,
    "amountPaise" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "status" "PaymentStatus" NOT NULL DEFAULT 'created',
    "method" TEXT,
    "failureReason" TEXT,
    "refundedPaise" INTEGER NOT NULL DEFAULT 0,
    "capturedAt" TIMESTAMP(3),
    "amountMismatch" BOOLEAN NOT NULL DEFAULT false,
    "gatewayAmountPaise" INTEGER,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "finance_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_payment_webhook_events" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "finance_payment_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "finance_payments_razorpayOrderId_key" ON "finance_payments"("razorpayOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "finance_payments_razorpayPaymentId_key" ON "finance_payments"("razorpayPaymentId");

-- CreateIndex
CREATE INDEX "idx_payment_order_ref" ON "finance_payments"("orderRef");

-- CreateIndex
CREATE INDEX "idx_payment_status" ON "finance_payments"("status");

-- CreateIndex
CREATE UNIQUE INDEX "finance_payment_webhook_events_eventId_key" ON "finance_payment_webhook_events"("eventId");
