import type { Prisma } from "@prisma/client";
import { prisma } from "../DB/Prisma.Connection.Db.js";
import {
  IRefreshToken,
  IRefreshTokenCreate,
  RevokeReason,
} from "../Models/RefreshToken/RefreshToken.Interface.js";

export type Db = Prisma.TransactionClient;

const inTransaction = async <T>(work: (tx: Db) => Promise<T>): Promise<T> => {
  try {
    return await prisma.$transaction(work);
  } catch (error) {
    throw error;
  }
};

const create = async (data: IRefreshTokenCreate, db: Db = prisma): Promise<IRefreshToken> => {
  try {
    return (await db.refreshToken.create({ data })) as IRefreshToken;
  } catch (error) {
    throw error;
  }
};

const findByHash = async (tokenHash: string): Promise<IRefreshToken | null> => {
  try {
    return (await prisma.refreshToken.findUnique({ where: { tokenHash } })) as IRefreshToken | null;
  } catch (error) {
    throw error;
  }
};

// The atomic step of rotation: only one of several simultaneous refreshes can flip
// revokedAt from null, so a token can never be spent twice. False means it lost.
const claimForRotation = async (id: string, db: Db = prisma): Promise<boolean> => {
  try {
    const { count } = await db.refreshToken.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: "rotated" },
    });
    return count === 1;
  } catch (error) {
    throw error;
  }
};

const revokeFamily = async (familyId: string, reason: RevokeReason): Promise<void> => {
  try {
    await prisma.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
  } catch (error) {
    throw error;
  }
};

const revokeAllForUser = async (userId: string, reason: RevokeReason): Promise<void> => {
  try {
    await prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
  } catch (error) {
    throw error;
  }
};

// Rows are kept a day past expiry so a late replay of a dead token is still recognised.
const purgeExpired = async (olderThan: Date): Promise<number> => {
  try {
    const { count } = await prisma.refreshToken.deleteMany({ where: { expiresAt: { lt: olderThan } } });
    return count;
  } catch (error) {
    throw error;
  }
};

export const RefreshTokenQuery = {
  inTransaction,
  create,
  findByHash,
  claimForRotation,
  revokeFamily,
  revokeAllForUser,
  purgeExpired,
};
