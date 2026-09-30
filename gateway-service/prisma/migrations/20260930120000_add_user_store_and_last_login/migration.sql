-- AlterTable
ALTER TABLE "gateway_users" ADD COLUMN     "lastLoginAt" TIMESTAMPTZ(6),
ADD COLUMN     "storeId" UUID;
