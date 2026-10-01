
-- CreateEnum
CREATE TYPE "CouponType" AS ENUM ('percent', 'flat', 'free_delivery');

-- CreateEnum
CREATE TYPE "CustomerPackageStatus" AS ENUM ('pending', 'active', 'exhausted', 'expired');

-- CreateEnum
CREATE TYPE "LoyaltyTransactionType" AS ENUM ('earn', 'redeem', 'expire', 'adjust');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('sms', 'email', 'whatsapp');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('queued', 'sent', 'failed');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('draft', 'scheduled', 'sending', 'sent', 'cancelled');

-- CreateEnum
CREATE TYPE "CampaignRecipientStatus" AS ENUM ('pending', 'sending', 'delivered', 'failed', 'skipped');

-- CreateTable
CREATE TABLE "growth_coupons" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "type" "CouponType" NOT NULL,
    "value" INTEGER NOT NULL,
    "minOrderPaise" INTEGER NOT NULL DEFAULT 0,
    "maxDiscountPaise" INTEGER,
    "validFrom" TIMESTAMPTZ(6) NOT NULL,
    "validUntil" TIMESTAMPTZ(6) NOT NULL,
    "usageLimit" INTEGER,
    "perCustomerLimit" INTEGER,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "storeIds" UUID[],
    "firstOrderOnly" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "growth_coupons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "growth_coupon_redemptions" (
    "id" UUID NOT NULL,
    "couponId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "orderRef" TEXT NOT NULL,
    "orderValuePaise" INTEGER NOT NULL,
    "discountPaise" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "growth_coupon_redemptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "growth_coupon_customer_usage" (
    "id" UUID NOT NULL,
    "couponId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "growth_coupon_customer_usage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "growth_prepaid_packages" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "pricePaise" INTEGER NOT NULL,
    "creditPaise" INTEGER NOT NULL,
    "validityDays" INTEGER NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "growth_prepaid_packages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "growth_customer_packages" (
    "id" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "packageId" UUID NOT NULL,
    "packageName" TEXT NOT NULL,
    "pricePaise" INTEGER NOT NULL,
    "creditPaise" INTEGER NOT NULL,
    "validityDays" INTEGER NOT NULL,
    "remainingCreditPaise" INTEGER NOT NULL,
    "status" "CustomerPackageStatus" NOT NULL DEFAULT 'pending',
    "orderRef" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(6),
    "activatedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "growth_customer_packages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "growth_loyalty_programs" (
    "id" UUID NOT NULL,
    "singleton" BOOLEAN NOT NULL DEFAULT true,
    "pointsPerRupeeMilli" INTEGER NOT NULL,
    "redemptionValuePaise" INTEGER NOT NULL,
    "expiryDays" INTEGER,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "growth_loyalty_programs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "growth_loyalty_tiers" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "minPoints" INTEGER NOT NULL,
    "benefits" TEXT[],
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "growth_loyalty_tiers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "growth_loyalty_accounts" (
    "id" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "points" INTEGER NOT NULL DEFAULT 0,
    "lifetimePoints" INTEGER NOT NULL DEFAULT 0,
    "lastEarnAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "growth_loyalty_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "growth_loyalty_transactions" (
    "id" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "type" "LoyaltyTransactionType" NOT NULL,
    "points" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "orderRef" TEXT,
    "actorId" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "growth_loyalty_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "growth_customer_stats" (
    "id" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "orderCount" INTEGER NOT NULL DEFAULT 0,
    "totalSpentPaise" INTEGER NOT NULL DEFAULT 0,
    "firstOrderAt" TIMESTAMPTZ(6) NOT NULL,
    "lastOrderAt" TIMESTAMPTZ(6) NOT NULL,
    "lastStoreId" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "growth_customer_stats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "growth_customer_orders" (
    "id" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "orderRef" TEXT NOT NULL,
    "storeId" UUID,
    "amountPaise" INTEGER NOT NULL,
    "completedAt" TIMESTAMPTZ(6) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "growth_customer_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "growth_notification_preferences" (
    "id" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "sms" BOOLEAN NOT NULL DEFAULT true,
    "email" BOOLEAN NOT NULL DEFAULT true,
    "whatsapp" BOOLEAN NOT NULL DEFAULT true,
    "push" BOOLEAN NOT NULL DEFAULT false,
    "language" TEXT NOT NULL DEFAULT 'en',
    "quietFrom" TEXT,
    "quietTo" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "growth_notification_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "growth_notification_templates" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "body" TEXT NOT NULL,
    "variables" TEXT[],
    "language" TEXT NOT NULL DEFAULT 'en',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "growth_notification_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "growth_notifications" (
    "id" UUID NOT NULL,
    "customerId" UUID,
    "channel" "NotificationChannel" NOT NULL,
    "recipient" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "params" JSONB NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'queued',
    "providerMessageId" TEXT,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "idempotencyKey" TEXT,
    "campaignId" UUID,
    "readAt" TIMESTAMPTZ(6),
    "sentAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "growth_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "growth_rate_counters" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "windowEndsAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "growth_rate_counters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "growth_campaigns" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "audience" JSONB NOT NULL,
    "templateId" UUID,
    "message" TEXT,
    "status" "CampaignStatus" NOT NULL DEFAULT 'draft',
    "scheduledAt" TIMESTAMPTZ(6),
    "startedAt" TIMESTAMPTZ(6),
    "completedAt" TIMESTAMPTZ(6),
    "cancelledAt" TIMESTAMPTZ(6),
    "cursor" UUID,
    "claimedCount" INTEGER NOT NULL DEFAULT 0,
    "leaseUntil" TIMESTAMPTZ(6),
    "maxRecipients" INTEGER NOT NULL,
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "growth_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "growth_campaign_recipients" (
    "id" UUID NOT NULL,
    "campaignId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "status" "CampaignRecipientStatus" NOT NULL DEFAULT 'pending',
    "error" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "growth_campaign_recipients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "growth_win_backs" (
    "id" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "couponId" UUID,
    "notificationId" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "growth_win_backs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "growth_coupons_code_key" ON "growth_coupons"("code");

-- CreateIndex
CREATE INDEX "idx_coupon_active_until" ON "growth_coupons"("isActive", "validUntil");

-- CreateIndex
CREATE INDEX "idx_coupon_created" ON "growth_coupons"("createdAt");

-- CreateIndex
CREATE INDEX "idx_redemption_coupon_customer" ON "growth_coupon_redemptions"("couponId", "customerId");

-- CreateIndex
CREATE INDEX "idx_redemption_customer_created" ON "growth_coupon_redemptions"("customerId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "uq_redemption_coupon_order" ON "growth_coupon_redemptions"("couponId", "orderRef");

-- CreateIndex
CREATE INDEX "idx_coupon_usage_customer" ON "growth_coupon_customer_usage"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "uq_coupon_usage_customer" ON "growth_coupon_customer_usage"("couponId", "customerId");

-- CreateIndex
CREATE INDEX "idx_package_active_created" ON "growth_prepaid_packages"("isActive", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "growth_customer_packages_orderRef_key" ON "growth_customer_packages"("orderRef");

-- CreateIndex
CREATE INDEX "idx_custpkg_customer_status" ON "growth_customer_packages"("customerId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "idx_custpkg_package_status" ON "growth_customer_packages"("packageId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "idx_custpkg_status_created" ON "growth_customer_packages"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "growth_loyalty_programs_singleton_key" ON "growth_loyalty_programs"("singleton");

-- CreateIndex
CREATE UNIQUE INDEX "growth_loyalty_tiers_name_key" ON "growth_loyalty_tiers"("name");

-- CreateIndex
CREATE UNIQUE INDEX "growth_loyalty_tiers_minPoints_key" ON "growth_loyalty_tiers"("minPoints");

-- CreateIndex
CREATE UNIQUE INDEX "growth_loyalty_accounts_customerId_key" ON "growth_loyalty_accounts"("customerId");

-- CreateIndex
CREATE INDEX "idx_loyalty_account_last_earn" ON "growth_loyalty_accounts"("lastEarnAt");

-- CreateIndex
CREATE INDEX "idx_loyalty_tx_customer_created" ON "growth_loyalty_transactions"("customerId", "createdAt");

-- CreateIndex
CREATE INDEX "idx_loyalty_tx_created" ON "growth_loyalty_transactions"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "uq_loyalty_tx_customer_type_ref" ON "growth_loyalty_transactions"("customerId", "type", "orderRef");

-- CreateIndex
CREATE UNIQUE INDEX "growth_customer_stats_customerId_key" ON "growth_customer_stats"("customerId");

-- CreateIndex
CREATE INDEX "idx_stat_last_order" ON "growth_customer_stats"("lastOrderAt");

-- CreateIndex
CREATE INDEX "idx_stat_store_last_order" ON "growth_customer_stats"("lastStoreId", "lastOrderAt");

-- CreateIndex
CREATE INDEX "idx_stat_order_count" ON "growth_customer_stats"("orderCount");

-- CreateIndex
CREATE INDEX "idx_stat_total_spent" ON "growth_customer_stats"("totalSpentPaise");

-- CreateIndex
CREATE UNIQUE INDEX "growth_customer_orders_orderRef_key" ON "growth_customer_orders"("orderRef");

-- CreateIndex
CREATE INDEX "idx_customer_order_history" ON "growth_customer_orders"("customerId", "completedAt");

-- CreateIndex
CREATE UNIQUE INDEX "growth_notification_preferences_customerId_key" ON "growth_notification_preferences"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "growth_notification_templates_name_key" ON "growth_notification_templates"("name");

-- CreateIndex
CREATE INDEX "idx_template_created" ON "growth_notification_templates"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "growth_notifications_idempotencyKey_key" ON "growth_notifications"("idempotencyKey");

-- CreateIndex
CREATE INDEX "idx_notification_customer_created" ON "growth_notifications"("customerId", "createdAt");

-- CreateIndex
CREATE INDEX "idx_notification_status_created" ON "growth_notifications"("status", "createdAt");

-- CreateIndex
CREATE INDEX "idx_notification_channel_created" ON "growth_notifications"("channel", "createdAt");

-- CreateIndex
CREATE INDEX "idx_notification_campaign" ON "growth_notifications"("campaignId");

-- CreateIndex
CREATE UNIQUE INDEX "growth_rate_counters_key_key" ON "growth_rate_counters"("key");

-- CreateIndex
CREATE INDEX "idx_rate_counter_window" ON "growth_rate_counters"("windowEndsAt");

-- CreateIndex
CREATE INDEX "idx_campaign_status_created" ON "growth_campaigns"("status", "createdAt");

-- CreateIndex
CREATE INDEX "idx_campaign_channel_created" ON "growth_campaigns"("channel", "createdAt");

-- CreateIndex
CREATE INDEX "idx_campaign_created" ON "growth_campaigns"("createdAt");

-- CreateIndex
CREATE INDEX "idx_campaign_template" ON "growth_campaigns"("templateId");

-- CreateIndex
CREATE INDEX "idx_recipient_campaign_status" ON "growth_campaign_recipients"("campaignId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "uq_recipient_campaign_customer" ON "growth_campaign_recipients"("campaignId", "customerId");

-- CreateIndex
CREATE INDEX "idx_winback_customer_created" ON "growth_win_backs"("customerId", "createdAt");

-- CreateIndex
CREATE INDEX "idx_winback_created" ON "growth_win_backs"("createdAt");

-- AddForeignKey
ALTER TABLE "growth_coupon_redemptions" ADD CONSTRAINT "growth_coupon_redemptions_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "growth_coupons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "growth_coupon_customer_usage" ADD CONSTRAINT "growth_coupon_customer_usage_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "growth_coupons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "growth_customer_packages" ADD CONSTRAINT "growth_customer_packages_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "growth_prepaid_packages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "growth_campaigns" ADD CONSTRAINT "growth_campaigns_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "growth_notification_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "growth_campaign_recipients" ADD CONSTRAINT "growth_campaign_recipients_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "growth_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Guards the conditional updates cannot express alone: a balance or a counter never goes negative.
ALTER TABLE "growth_loyalty_accounts" ADD CONSTRAINT "chk_loyalty_points_nonneg" CHECK ("points" >= 0 AND "lifetimePoints" >= 0);
ALTER TABLE "growth_coupons" ADD CONSTRAINT "chk_coupon_used_nonneg" CHECK ("usedCount" >= 0);
ALTER TABLE "growth_coupons" ADD CONSTRAINT "chk_coupon_window" CHECK ("validUntil" >= "validFrom");
ALTER TABLE "growth_customer_packages" ADD CONSTRAINT "chk_custpkg_remaining_nonneg" CHECK ("remainingCreditPaise" >= 0);
ALTER TABLE "growth_coupon_customer_usage" ADD CONSTRAINT "chk_coupon_usage_nonneg" CHECK ("usedCount" >= 0);
