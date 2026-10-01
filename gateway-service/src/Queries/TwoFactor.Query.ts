import { prisma } from "../DB/Prisma.Connection.Db.js";
import {
  ITwoFactorChallenge,
  ITwoFactorCredential,
  ITwoFactorRecoveryCode,
} from "../Models/TwoFactor/TwoFactor.Interface.js";

const credentialSelect = {
  id: true,
  userId: true,
  secretEnc: true,
  enabledAt: true,
  lastUsedStep: true,
  failedAttempts: true,
  lockedUntil: true,
} as const;

const challengeSelect = { id: true, userId: true, expiresAt: true, consumedAt: true } as const;

const findCredential = async (userId: string): Promise<ITwoFactorCredential | null> => {
  try {
    return await prisma.twoFactorCredential.findUnique({ where: { userId }, select: credentialSelect });
  } catch (error) {
    throw error;
  }
};

// A pending row is replaced, so scanning a fresh QR code always works. If the user is already
// enabled the create hits the unique index on userId, which the service reports as a conflict.
const replacePending = async (userId: string, secretEnc: string): Promise<void> => {
  try {
    await prisma.$transaction(async (tx) => {
      await tx.twoFactorCredential.deleteMany({ where: { userId, enabledAt: null } });
      await tx.twoFactorCredential.create({ data: { userId, secretEnc } });
    });
  } catch (error) {
    throw error;
  }
};

// Switches enrolment on and stores the backup codes in one step. False means it was no longer
// pending (a concurrent call enabled it first), and nothing is written.
const activate = async (userId: string, step: number, recoveryHashes: string[]): Promise<boolean> => {
  try {
    return await prisma.$transaction(async (tx) => {
      const { count } = await tx.twoFactorCredential.updateMany({
        where: { userId, enabledAt: null },
        data: { enabledAt: new Date(), lastUsedStep: step, failedAttempts: 0, lockedUntil: null },
      });
      if (count !== 1) return false;
      await tx.twoFactorRecoveryCode.deleteMany({ where: { userId } });
      await tx.twoFactorRecoveryCode.createMany({
        data: recoveryHashes.map((codeHash) => ({ userId, codeHash })),
      });
      return true;
    });
  } catch (error) {
    throw error;
  }
};

const remove = async (userId: string): Promise<void> => {
  try {
    await prisma.$transaction(async (tx) => {
      await tx.twoFactorRecoveryCode.deleteMany({ where: { userId } });
      await tx.twoFactorChallenge.deleteMany({ where: { userId } });
      await tx.twoFactorCredential.deleteMany({ where: { userId } });
    });
  } catch (error) {
    throw error;
  }
};

// Compare-and-set on the step: of two requests presenting the same code only one can move
// lastUsedStep forward, so a code is spent exactly once.
const advanceStep = async (userId: string, step: number): Promise<boolean> => {
  try {
    const { count } = await prisma.twoFactorCredential.updateMany({
      where: { userId, enabledAt: { not: null }, lastUsedStep: { lt: step } },
      data: { lastUsedStep: step },
    });
    return count === 1;
  } catch (error) {
    throw error;
  }
};

// Counts a wrong code and locks the credential once the limit is reached. Returns the
// consecutive failures still allowed (0 when it has just locked).
const recordFailure = async (userId: string, maxFailures: number, lockUntil: Date): Promise<number> => {
  try {
    const row = await prisma.twoFactorCredential.update({
      where: { userId },
      data: { failedAttempts: { increment: 1 } },
      select: { failedAttempts: true },
    });
    if (row.failedAttempts < maxFailures) return maxFailures - row.failedAttempts;
    await prisma.twoFactorCredential.update({
      where: { userId },
      data: { failedAttempts: 0, lockedUntil: lockUntil },
    });
    return 0;
  } catch (error) {
    throw error;
  }
};

const resetFailures = async (userId: string): Promise<void> => {
  try {
    await prisma.twoFactorCredential.updateMany({
      where: { userId, OR: [{ failedAttempts: { gt: 0 } }, { lockedUntil: { not: null } }] },
      data: { failedAttempts: 0, lockedUntil: null },
    });
  } catch (error) {
    throw error;
  }
};

const listUnusedRecoveryCodes = async (userId: string): Promise<ITwoFactorRecoveryCode[]> => {
  try {
    return await prisma.twoFactorRecoveryCode.findMany({
      where: { userId, usedAt: null },
      select: { id: true, userId: true, codeHash: true },
      take: 20,
    });
  } catch (error) {
    throw error;
  }
};

const claimRecoveryCode = async (id: string): Promise<boolean> => {
  try {
    const { count } = await prisma.twoFactorRecoveryCode.updateMany({
      where: { id, usedAt: null },
      data: { usedAt: new Date() },
    });
    return count === 1;
  } catch (error) {
    throw error;
  }
};

const createChallenge = async (userId: string, expiresAt: Date): Promise<ITwoFactorChallenge> => {
  try {
    return await prisma.twoFactorChallenge.create({ data: { userId, expiresAt }, select: challengeSelect });
  } catch (error) {
    throw error;
  }
};

const findChallenge = async (id: string): Promise<ITwoFactorChallenge | null> => {
  try {
    return await prisma.twoFactorChallenge.findUnique({ where: { id }, select: challengeSelect });
  } catch (error) {
    throw error;
  }
};

// Spends the challenge. False means it was already spent or has expired, so a second request loses.
const consumeChallenge = async (id: string, now: Date): Promise<boolean> => {
  try {
    const { count } = await prisma.twoFactorChallenge.updateMany({
      where: { id, consumedAt: null, expiresAt: { gt: now } },
      data: { consumedAt: now },
    });
    return count === 1;
  } catch (error) {
    throw error;
  }
};

const purgeChallenges = async (olderThan: Date): Promise<number> => {
  try {
    const { count } = await prisma.twoFactorChallenge.deleteMany({ where: { expiresAt: { lt: olderThan } } });
    return count;
  } catch (error) {
    throw error;
  }
};

export const TwoFactorQuery = {
  findCredential,
  replacePending,
  activate,
  remove,
  advanceStep,
  recordFailure,
  resetFailures,
  listUnusedRecoveryCodes,
  claimRecoveryCode,
  createChallenge,
  findChallenge,
  consumeChallenge,
  purgeChallenges,
};
