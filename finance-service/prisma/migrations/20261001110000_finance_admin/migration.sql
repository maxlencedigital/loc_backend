-- CreateEnum
CREATE TYPE "MismatchResolution" AS ENUM ('matched', 'refunded', 'written_off', 'manual_adjust');

-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('requested', 'approved', 'processed', 'failed');

-- CreateEnum
CREATE TYPE "ReconciliationSource" AS ENUM ('bank', 'razorpay');

-- CreateEnum
CREATE TYPE "SpendMode" AS ENUM ('cash', 'bank', 'upi', 'card');

-- CreateEnum
CREATE TYPE "ExpenseStatus" AS ENUM ('recorded', 'approved', 'rejected', 'paid');

-- CreateEnum
CREATE TYPE "OperatingCostType" AS ENUM ('rent', 'electricity', 'water', 'internet', 'salary', 'insurance', 'maintenance', 'other');

-- CreateEnum
CREATE TYPE "CostFrequency" AS ENUM ('monthly', 'quarterly', 'yearly');

-- CreateEnum
CREATE TYPE "GstStatus" AS ENUM ('draft', 'ready', 'filed');

-- CreateEnum
CREATE TYPE "DailyCloseStatus" AS ENUM ('closed', 'approved');

-- CreateEnum
CREATE TYPE "CashEntryKind" AS ENUM ('counted', 'deposit');

-- CreateEnum
CREATE TYPE "VarianceStatus" AS ENUM ('open', 'resolved');

-- AlterTable
ALTER TABLE "finance_payments" ADD COLUMN     "customerUserId" UUID,
ADD COLUMN     "idempotencyKey" VARCHAR(128),
ADD COLUMN     "idempotencyOwner" VARCHAR(64),
ADD COLUMN     "storeId" UUID;

-- CreateTable
CREATE TABLE "finance_payment_mismatch_resolutions" (
    "id" UUID NOT NULL,
    "paymentId" TEXT NOT NULL,
    "resolution" "MismatchResolution" NOT NULL,
    "note" VARCHAR(1000) NOT NULL,
    "resolvedByUserId" VARCHAR(64) NOT NULL,
    "resolvedByName" VARCHAR(120),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "finance_payment_mismatch_resolutions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_refunds" (
    "id" UUID NOT NULL,
    "paymentId" TEXT NOT NULL,
    "storeId" UUID,
    "amountPaise" INTEGER NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "status" "RefundStatus" NOT NULL DEFAULT 'requested',
    "idempotencyKey" VARCHAR(128),
    "razorpayRefundId" TEXT,
    "failureReason" VARCHAR(300),
    "requestedByUserId" VARCHAR(64) NOT NULL,
    "approvedByUserId" VARCHAR(64),
    "approvedAt" TIMESTAMPTZ(6),
    "processedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "finance_refunds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_bank_statements" (
    "id" UUID NOT NULL,
    "bank" VARCHAR(80),
    "fileName" VARCHAR(200) NOT NULL,
    "lineCount" INTEGER NOT NULL,
    "skippedCount" INTEGER NOT NULL,
    "uploadedByUserId" VARCHAR(64) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "finance_bank_statements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_bank_statement_lines" (
    "id" UUID NOT NULL,
    "statementId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "description" VARCHAR(300) NOT NULL,
    "reference" VARCHAR(120),
    "amountPaise" INTEGER NOT NULL,
    "lineHash" VARCHAR(64) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "finance_bank_statement_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_reconciliation_runs" (
    "id" UUID NOT NULL,
    "source" "ReconciliationSource" NOT NULL,
    "fromDate" DATE NOT NULL,
    "toDate" DATE NOT NULL,
    "matched" INTEGER NOT NULL,
    "exceptionCount" INTEGER NOT NULL,
    "truncated" BOOLEAN NOT NULL DEFAULT false,
    "ranByUserId" VARCHAR(64) NOT NULL,
    "ranAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "finance_reconciliation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_reconciliation_exceptions" (
    "id" UUID NOT NULL,
    "runId" UUID NOT NULL,
    "reference" VARCHAR(120) NOT NULL,
    "expectedPaise" INTEGER,
    "actualPaise" INTEGER,
    "reason" VARCHAR(40) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "finance_reconciliation_exceptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_expense_categories" (
    "id" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "nameKey" VARCHAR(80) NOT NULL,
    "parentId" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "finance_expense_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_expenses" (
    "id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "categoryId" UUID NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "storeId" UUID,
    "vendorId" UUID,
    "description" VARCHAR(500),
    "paymentMode" "SpendMode",
    "status" "ExpenseStatus" NOT NULL DEFAULT 'recorded',
    "createdByUserId" VARCHAR(64) NOT NULL,
    "idempotencyKey" VARCHAR(128),
    "deletedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "finance_expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_expense_events" (
    "id" UUID NOT NULL,
    "expenseId" UUID NOT NULL,
    "action" VARCHAR(30) NOT NULL,
    "fromStatus" "ExpenseStatus",
    "toStatus" "ExpenseStatus" NOT NULL,
    "actorUserId" VARCHAR(64) NOT NULL,
    "actorName" VARCHAR(120),
    "note" VARCHAR(500),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "finance_expense_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_expense_receipts" (
    "id" UUID NOT NULL,
    "expenseId" UUID NOT NULL,
    "fileName" VARCHAR(200) NOT NULL,
    "contentType" VARCHAR(100) NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" VARCHAR(64) NOT NULL,
    "content" BYTEA NOT NULL,
    "uploadedByUserId" VARCHAR(64) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "finance_expense_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_operating_costs" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "type" "OperatingCostType" NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "frequency" "CostFrequency" NOT NULL,
    "storeId" UUID,
    "dueDay" SMALLINT,
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "vendorId" UUID,
    "deletedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "finance_operating_costs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_gst_reports" (
    "id" UUID NOT NULL,
    "month" VARCHAR(7) NOT NULL,
    "status" "GstStatus" NOT NULL DEFAULT 'draft',
    "rateBps" INTEGER NOT NULL,
    "grossPaise" BIGINT NOT NULL,
    "refundsPaise" BIGINT NOT NULL,
    "taxablePaise" BIGINT NOT NULL,
    "taxPaise" BIGINT NOT NULL,
    "cgstPaise" BIGINT NOT NULL,
    "sgstPaise" BIGINT NOT NULL,
    "orderCount" INTEGER NOT NULL,
    "storeIds" UUID[],
    "lines" JSONB NOT NULL,
    "generatedAt" TIMESTAMPTZ(6) NOT NULL,
    "generatedByUserId" VARCHAR(64) NOT NULL,
    "filedAt" TIMESTAMPTZ(6),
    "filedByUserId" VARCHAR(64),
    "acknowledgement" VARCHAR(64),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "finance_gst_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_ledger_entries" (
    "id" UUID NOT NULL,
    "journalId" UUID NOT NULL,
    "lineNo" SMALLINT NOT NULL,
    "date" DATE NOT NULL,
    "account" VARCHAR(100) NOT NULL,
    "debitPaise" INTEGER NOT NULL,
    "creditPaise" INTEGER NOT NULL,
    "reference" VARCHAR(120) NOT NULL,
    "storeId" UUID,
    "sourceType" VARCHAR(30) NOT NULL,
    "sourceId" VARCHAR(64) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "finance_ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_receivables" (
    "id" UUID NOT NULL,
    "invoiceId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "orderRef" VARCHAR(64),
    "amountPaise" INTEGER NOT NULL,
    "balancePaise" INTEGER NOT NULL,
    "dueOn" DATE NOT NULL,
    "contactPhone" VARCHAR(20),
    "contactEmail" VARCHAR(254),
    "lastRemindedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "finance_receivables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_receivable_payments" (
    "id" UUID NOT NULL,
    "receivableId" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "mode" "SpendMode" NOT NULL,
    "reference" VARCHAR(120),
    "idempotencyKey" VARCHAR(128),
    "recordedByUserId" VARCHAR(64) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "finance_receivable_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_receivable_reminders" (
    "id" UUID NOT NULL,
    "receivableId" UUID NOT NULL,
    "channel" VARCHAR(20) NOT NULL,
    "delivered" BOOLEAN NOT NULL,
    "error" VARCHAR(200),
    "sentByUserId" VARCHAR(64) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "finance_receivable_reminders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_daily_closes" (
    "id" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "storeName" VARCHAR(120),
    "date" DATE NOT NULL,
    "expectedPaise" INTEGER NOT NULL,
    "closedByUserId" VARCHAR(64),
    "closedByName" VARCHAR(120) NOT NULL,
    "status" "DailyCloseStatus" NOT NULL DEFAULT 'closed',
    "approvedByUserId" VARCHAR(64),
    "approvedAt" TIMESTAMPTZ(6),
    "approvalNote" VARCHAR(500),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "finance_daily_closes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_cash_book_entries" (
    "id" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "kind" "CashEntryKind" NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "reference" VARCHAR(120),
    "idempotencyKey" VARCHAR(128) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "finance_cash_book_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_cash_variances" (
    "id" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "status" "VarianceStatus" NOT NULL DEFAULT 'open',
    "resolution" VARCHAR(300),
    "note" VARCHAR(500),
    "resolvedByUserId" VARCHAR(64),
    "resolvedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "finance_cash_variances_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "finance_payment_mismatch_resolutions_paymentId_key" ON "finance_payment_mismatch_resolutions"("paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "finance_refunds_razorpayRefundId_key" ON "finance_refunds"("razorpayRefundId");

-- CreateIndex
CREATE INDEX "idx_refund_payment" ON "finance_refunds"("paymentId");

-- CreateIndex
CREATE INDEX "idx_refund_created" ON "finance_refunds"("createdAt");

-- CreateIndex
CREATE INDEX "idx_refund_status_created" ON "finance_refunds"("status", "createdAt");

-- CreateIndex
CREATE INDEX "idx_refund_store_processed" ON "finance_refunds"("storeId", "processedAt");

-- CreateIndex
CREATE UNIQUE INDEX "uq_refund_payment_key" ON "finance_refunds"("paymentId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "idx_bank_statement_created" ON "finance_bank_statements"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "finance_bank_statement_lines_lineHash_key" ON "finance_bank_statement_lines"("lineHash");

-- CreateIndex
CREATE INDEX "idx_bank_line_statement" ON "finance_bank_statement_lines"("statementId");

-- CreateIndex
CREATE INDEX "idx_bank_line_date" ON "finance_bank_statement_lines"("date");

-- CreateIndex
CREATE INDEX "idx_recon_run_ran_at" ON "finance_reconciliation_runs"("ranAt");

-- CreateIndex
CREATE INDEX "idx_recon_exception_run" ON "finance_reconciliation_exceptions"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "finance_expense_categories_nameKey_key" ON "finance_expense_categories"("nameKey");

-- CreateIndex
CREATE INDEX "idx_expense_category_parent" ON "finance_expense_categories"("parentId");

-- CreateIndex
CREATE INDEX "idx_expense_date" ON "finance_expenses"("date");

-- CreateIndex
CREATE INDEX "idx_expense_store_date" ON "finance_expenses"("storeId", "date");

-- CreateIndex
CREATE INDEX "idx_expense_category_date" ON "finance_expenses"("categoryId", "date");

-- CreateIndex
CREATE INDEX "idx_expense_status_date" ON "finance_expenses"("status", "date");

-- CreateIndex
CREATE UNIQUE INDEX "uq_expense_creator_key" ON "finance_expenses"("createdByUserId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "idx_expense_event_expense" ON "finance_expense_events"("expenseId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "uq_expense_receipt_hash" ON "finance_expense_receipts"("expenseId", "sha256");

-- CreateIndex
CREATE INDEX "idx_operating_cost_store" ON "finance_operating_costs"("storeId", "createdAt");

-- CreateIndex
CREATE INDEX "idx_operating_cost_type" ON "finance_operating_costs"("type", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "finance_gst_reports_month_key" ON "finance_gst_reports"("month");

-- CreateIndex
CREATE INDEX "idx_ledger_date" ON "finance_ledger_entries"("date");

-- CreateIndex
CREATE INDEX "idx_ledger_account_date" ON "finance_ledger_entries"("account", "date");

-- CreateIndex
CREATE INDEX "idx_ledger_store_date" ON "finance_ledger_entries"("storeId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "uq_ledger_source_line" ON "finance_ledger_entries"("sourceType", "sourceId", "lineNo");

-- CreateIndex
CREATE UNIQUE INDEX "finance_receivables_invoiceId_key" ON "finance_receivables"("invoiceId");

-- CreateIndex
CREATE INDEX "idx_receivable_customer" ON "finance_receivables"("customerId");

-- CreateIndex
CREATE INDEX "idx_receivable_store_due" ON "finance_receivables"("storeId", "dueOn");

-- CreateIndex
CREATE INDEX "idx_receivable_due" ON "finance_receivables"("dueOn");

-- CreateIndex
CREATE INDEX "idx_receivable_payment_receivable" ON "finance_receivable_payments"("receivableId");

-- CreateIndex
CREATE UNIQUE INDEX "uq_receivable_payment_key" ON "finance_receivable_payments"("receivableId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "idx_receivable_reminder_receivable" ON "finance_receivable_reminders"("receivableId", "createdAt");

-- CreateIndex
CREATE INDEX "idx_daily_close_date" ON "finance_daily_closes"("date");

-- CreateIndex
CREATE UNIQUE INDEX "uq_daily_close_store_date" ON "finance_daily_closes"("storeId", "date");

-- CreateIndex
CREATE INDEX "idx_cash_entry_store_date" ON "finance_cash_book_entries"("storeId", "date");

-- CreateIndex
CREATE INDEX "idx_cash_entry_date" ON "finance_cash_book_entries"("date");

-- CreateIndex
CREATE UNIQUE INDEX "uq_cash_entry_key" ON "finance_cash_book_entries"("storeId", "kind", "idempotencyKey");

-- CreateIndex
CREATE INDEX "idx_cash_variance_date" ON "finance_cash_variances"("date");

-- CreateIndex
CREATE INDEX "idx_cash_variance_status_date" ON "finance_cash_variances"("status", "date");

-- CreateIndex
CREATE UNIQUE INDEX "uq_cash_variance_store_date" ON "finance_cash_variances"("storeId", "date");

-- CreateIndex
CREATE INDEX "idx_payment_created" ON "finance_payments"("createdAt");

-- CreateIndex
CREATE INDEX "idx_payment_status_created" ON "finance_payments"("status", "createdAt");

-- CreateIndex
CREATE INDEX "idx_payment_store_created" ON "finance_payments"("storeId", "createdAt");

-- CreateIndex
CREATE INDEX "idx_payment_method_created" ON "finance_payments"("method", "createdAt");

-- CreateIndex
CREATE INDEX "idx_payment_mismatch_created" ON "finance_payments"("amountMismatch", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "uq_payment_idempotency" ON "finance_payments"("idempotencyOwner", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "finance_payment_mismatch_resolutions" ADD CONSTRAINT "finance_payment_mismatch_resolutions_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "finance_payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_refunds" ADD CONSTRAINT "finance_refunds_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "finance_payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_bank_statement_lines" ADD CONSTRAINT "finance_bank_statement_lines_statementId_fkey" FOREIGN KEY ("statementId") REFERENCES "finance_bank_statements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_reconciliation_exceptions" ADD CONSTRAINT "finance_reconciliation_exceptions_runId_fkey" FOREIGN KEY ("runId") REFERENCES "finance_reconciliation_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_expense_categories" ADD CONSTRAINT "finance_expense_categories_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "finance_expense_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_expenses" ADD CONSTRAINT "finance_expenses_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "finance_expense_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_expense_events" ADD CONSTRAINT "finance_expense_events_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "finance_expenses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_expense_receipts" ADD CONSTRAINT "finance_expense_receipts_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "finance_expenses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_receivable_payments" ADD CONSTRAINT "finance_receivable_payments_receivableId_fkey" FOREIGN KEY ("receivableId") REFERENCES "finance_receivables"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_receivable_reminders" ADD CONSTRAINT "finance_receivable_reminders_receivableId_fkey" FOREIGN KEY ("receivableId") REFERENCES "finance_receivables"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Business-rule checks the Prisma schema cannot express.
ALTER TABLE "finance_refunds" ADD CONSTRAINT "ck_refund_amount" CHECK ("amountPaise" > 0);
ALTER TABLE "finance_expenses" ADD CONSTRAINT "ck_expense_amount" CHECK ("amountPaise" > 0);
ALTER TABLE "finance_operating_costs" ADD CONSTRAINT "ck_operating_cost_amount" CHECK ("amountPaise" > 0);
ALTER TABLE "finance_operating_costs" ADD CONSTRAINT "ck_operating_cost_due_day" CHECK ("dueDay" IS NULL OR ("dueDay" BETWEEN 1 AND 28));
ALTER TABLE "finance_operating_costs" ADD CONSTRAINT "ck_operating_cost_dates" CHECK ("endDate" IS NULL OR "endDate" >= "startDate");
ALTER TABLE "finance_ledger_entries" ADD CONSTRAINT "ck_ledger_one_side" CHECK ("debitPaise" >= 0 AND "creditPaise" >= 0 AND ("debitPaise" = 0 OR "creditPaise" = 0) AND ("debitPaise" + "creditPaise") > 0);
ALTER TABLE "finance_receivables" ADD CONSTRAINT "ck_receivable_balance" CHECK ("amountPaise" > 0 AND "balancePaise" >= 0 AND "balancePaise" <= "amountPaise");
ALTER TABLE "finance_receivable_payments" ADD CONSTRAINT "ck_receivable_payment_amount" CHECK ("amountPaise" > 0);
ALTER TABLE "finance_cash_book_entries" ADD CONSTRAINT "ck_cash_entry_amount" CHECK ("amountPaise" >= 0);
ALTER TABLE "finance_daily_closes" ADD CONSTRAINT "ck_daily_close_expected" CHECK ("expectedPaise" >= 0);
ALTER TABLE "finance_gst_reports" ADD CONSTRAINT "ck_gst_month" CHECK ("month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$');
