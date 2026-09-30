import { prisma } from "../DB/Prisma.Connection.Db.js";
import {
  IOtpChallenge,
  IOtpChallengeCreate,
  OtpPurpose,
} from "../Models/OtpChallenge/OtpChallenge.Interface.js";

const create = async (challenge: IOtpChallengeCreate): Promise<IOtpChallenge> => {
  try {
    return await prisma.otpChallenge.create({ data: challenge });
  } catch (error) {
    throw error;
  }
};

const findById = async (id: string): Promise<IOtpChallenge | null> => {
  try {
    return await prisma.otpChallenge.findUnique({ where: { id } });
  } catch (error) {
    throw error;
  }
};

const recordAttempt = async (id: string): Promise<void> => {
  try {
    // Atomic increment rather than read-modify-write: two simultaneous wrong
    // guesses must both count, or the attempt cap can be walked past by racing.
    await prisma.otpChallenge.update({
      where: { id },
      data: { attempts: { increment: 1 } },
    });
  } catch (error) {
    throw error;
  }
};

// The destination is proven but the challenge is not spent. newExpiresAt
// extends the deadline so the form can be finished without expiring mid-typing.
const markVerified = async (id: string, newExpiresAt: Date): Promise<void> => {
  try {
    await prisma.otpChallenge.update({
      where: { id },
      data: { verifiedAt: new Date(), expiresAt: newExpiresAt },
    });
  } catch (error) {
    throw error;
  }
};

/** The challenge is spent and can never be used again. */
const markConsumed = async (id: string): Promise<void> => {
  try {
    await prisma.otpChallenge.update({
      where: { id },
      data: { consumedAt: new Date() },
    });
  } catch (error) {
    throw error;
  }
};

// Input to the resend throttle. Limiting by IP alone would not stop someone
// cycling IPs to spam one person's phone and run up the SMS bill.
const countRecentFor = async (
  destination: string,
  purpose: OtpPurpose,
  since: Date
): Promise<number> => {
  try {
    return await prisma.otpChallenge.count({
      where: { destination, purpose, createdAt: { gte: since } },
    });
  } catch (error) {
    throw error;
  }
};

const findLatestFor = async (
  destination: string,
  purpose: OtpPurpose
): Promise<IOtpChallenge | null> => {
  try {
    return await prisma.otpChallenge.findFirst({
      where: { destination, purpose },
      orderBy: { createdAt: "desc" },
    });
  } catch (error) {
    throw error;
  }
};

// Housekeeping: expired challenges are useless but still hold a phone number
// and email, so there is no reason to keep them.
const deleteExpiredBefore = async (cutoff: Date): Promise<number> => {
  try {
    const { count } = await prisma.otpChallenge.deleteMany({
      where: { expiresAt: { lt: cutoff } },
    });
    return count;
  } catch (error) {
    throw error;
  }
};

export const OtpChallengeQuery = {
  create,
  findById,
  recordAttempt,
  markVerified,
  markConsumed,
  countRecentFor,
  findLatestFor,
  deleteExpiredBefore,
};
