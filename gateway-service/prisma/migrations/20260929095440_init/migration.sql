-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "gateway";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('super_admin', 'admin', 'staff', 'driver', 'customer');

-- CreateEnum
CREATE TYPE "OAuthProvider" AS ENUM ('google', 'facebook', 'apple');

-- CreateEnum
CREATE TYPE "OtpPurpose" AS ENUM ('register', 'login', 'password_reset');

-- CreateTable
CREATE TABLE "gateway_users" (
    "id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "email" VARCHAR(150) NOT NULL,
    "passwordHash" VARCHAR(255),
    "phoneNumber" VARCHAR(20),
    "isPhoneVerified" BOOLEAN NOT NULL DEFAULT false,
    "oauthProvider" "OAuthProvider",
    "oauthSubject" VARCHAR(255),
    "role" "UserRole" NOT NULL DEFAULT 'customer',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "gateway_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "otp_challenges" (
    "id" UUID NOT NULL,
    "purpose" "OtpPurpose" NOT NULL,
    "destination" VARCHAR(150) NOT NULL,
    "otpHash" VARCHAR(255) NOT NULL,
    "userId" UUID,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "verifiedAt" TIMESTAMPTZ(6),
    "consumedAt" TIMESTAMPTZ(6),
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "otp_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_logs" (
    "id" UUID NOT NULL,
    "service" VARCHAR(50) NOT NULL,
    "method" VARCHAR(10) NOT NULL,
    "path" VARCHAR(255) NOT NULL,
    "userId" UUID,
    "statusCode" INTEGER NOT NULL,
    "ip" VARCHAR(45),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "gateway_users_email_key" ON "gateway_users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "gateway_users_phoneNumber_key" ON "gateway_users"("phoneNumber");

-- CreateIndex
CREATE UNIQUE INDEX "uniq_oauth_identity" ON "gateway_users"("oauthProvider", "oauthSubject");

-- CreateIndex
CREATE INDEX "idx_destination_purpose" ON "otp_challenges"("destination", "purpose");

-- CreateIndex
CREATE INDEX "idx_expires_at" ON "otp_challenges"("expiresAt");

-- CreateIndex
CREATE INDEX "idx_activity_created_at" ON "activity_logs"("createdAt");

