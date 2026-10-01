-- AlterEnum
ALTER TYPE "OtpPurpose" ADD VALUE 'phone_change';

-- CreateEnum
CREATE TYPE "UserTokenPurpose" AS ENUM ('invite', 'password_reset');

-- CreateTable
CREATE TABLE "two_factor_credentials" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "secretEnc" VARCHAR(255) NOT NULL,
    "enabledAt" TIMESTAMPTZ(6),
    "lastUsedStep" INTEGER NOT NULL DEFAULT 0,
    "failedAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "two_factor_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "two_factor_recovery_codes" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "codeHash" VARCHAR(255) NOT NULL,
    "usedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "two_factor_recovery_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "two_factor_challenges" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "consumedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "two_factor_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_tokens" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "purpose" "UserTokenPurpose" NOT NULL,
    "tokenHash" CHAR(64) NOT NULL,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "consumedAt" TIMESTAMPTZ(6),
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "two_factor_credentials_userId_key" ON "two_factor_credentials"("userId");

-- CreateIndex
CREATE INDEX "idx_2fa_recovery_user" ON "two_factor_recovery_codes"("userId");

-- CreateIndex
CREATE INDEX "idx_2fa_challenge_user" ON "two_factor_challenges"("userId");

-- CreateIndex
CREATE INDEX "idx_2fa_challenge_expires" ON "two_factor_challenges"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "user_tokens_tokenHash_key" ON "user_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "idx_user_token_user_purpose" ON "user_tokens"("userId", "purpose");

-- CreateIndex
CREATE INDEX "idx_user_token_expires" ON "user_tokens"("expiresAt");

-- AddForeignKey
ALTER TABLE "two_factor_credentials" ADD CONSTRAINT "two_factor_credentials_userId_fkey" FOREIGN KEY ("userId") REFERENCES "gateway_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "two_factor_recovery_codes" ADD CONSTRAINT "two_factor_recovery_codes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "gateway_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "two_factor_challenges" ADD CONSTRAINT "two_factor_challenges_userId_fkey" FOREIGN KEY ("userId") REFERENCES "gateway_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_tokens" ADD CONSTRAINT "user_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "gateway_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
