-- CreateTable
CREATE TABLE "commerce_ess_idempotency_keys" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "operation" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "resourceId" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commerce_ess_idempotency_keys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "uq_ess_idem_employee_op_key" ON "commerce_ess_idempotency_keys"("employeeId", "operation", "key");

-- CreateIndex
CREATE INDEX "idx_ess_idem_created" ON "commerce_ess_idempotency_keys"("createdAt");
