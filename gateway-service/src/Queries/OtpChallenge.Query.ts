import { prisma } from "../DB/Prisma.Connection.Db.js";
import {
  IOtpChallenge,
  IOtpChallengeCreate,
  OtpPurpose,
} from "../Models/OtpChallenge/OtpChallenge.Interface.js";

const create = async (challenge: IOtpChallengeCreate): Promise<IOtpChallenge> => {
  return prisma.otpChallenge.create({ data: challenge });
};

const findById = async (id: string): Promise<IOtpChallenge | null> => {
  return prisma.otpChallenge.findUnique({ where: { id } });
};

const recordAttempt = async (id: string): Promise<void> => {
  // Atomic increment rather than read-modify-write: two simultaneous wrong
  // guesses must both count, or the attempt cap can be walked past by racing.
  await prisma.otpChallenge.update({
    where: { id },
    data: { attempts: { increment: 1 } },
  });
};

// The destination is proven but the challenge is not spent. newExpiresAt
// extends the deadline so the form can be finished without expiring mid-typing.
const markVerified = async (id: string, newExpiresAt: Date): Promise<void> => {
  await prisma.otpChallenge.update({
    where: { id },
    data: { verifiedAt: new Date(), expiresAt: newExpiresAt },
  });
};

/** The challenge is spent and can never be used again. */
const markConsumed = async (id: string): Promise<void> => {
  await prisma.otpChallenge.update({
    where: { id },
    data: { consumedAt: new Date() },
  });
};

// Input to the resend throttle. Limiting by IP alone would not stop someone
// cycling IPs to spam one person's phone and run up the SMS bill.
const countRecentFor = async (
  destination: string,
  purpose: OtpPurpose,
  since: Date
): Promise<number> => {
  return prisma.otpChallenge.count({
    where: { destination, purpose, createdAt: { gte: since } },
  });
};

const findLatestFor = async (
  destination: string,
  purpose: OtpPurpose
): Promise<IOtpChallenge | null> => {
  return prisma.otpChallenge.findFirst({
    where: { destination, purpose },
    orderBy: { createdAt: "desc" },
  });
};

// Housekeeping: expired challenges are useless but still hold a phone number
// and email, so there is no reason to keep them.
const deleteExpiredBefore = async (cutoff: Date): Promise<number> => {
  const { count } = await prisma.otpChallenge.deleteMany({
    where: { expiresAt: { lt: cutoff } },
  });
  return count;
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
