import { prisma } from "../DB/Prisma.Connection.Db.js";
import { Db } from "./RefreshToken.Query.js";
import { IUserToken, IUserTokenCreate, UserTokenPurpose } from "../Models/UserToken/UserToken.Interface.js";

const inTransaction = async <T>(work: (tx: Db) => Promise<T>): Promise<T> => {
  try {
    return await prisma.$transaction(work);
  } catch (error) {
    throw error;
  }
};

const create = async (data: IUserTokenCreate, db: Db = prisma): Promise<IUserToken> => {
  try {
    return (await db.userToken.create({ data })) as IUserToken;
  } catch (error) {
    throw error;
  }
};

const findByHash = async (tokenHash: string): Promise<IUserToken | null> => {
  try {
    return (await prisma.userToken.findUnique({ where: { tokenHash } })) as IUserToken | null;
  } catch (error) {
    throw error;
  }
};

const findLatest = async (userId: string, purpose: UserTokenPurpose): Promise<IUserToken | null> => {
  try {
    return (await prisma.userToken.findFirst({
      where: { userId, purpose },
      orderBy: { createdAt: "desc" },
    })) as IUserToken | null;
  } catch (error) {
    throw error;
  }
};

// Compare-and-set: of two simultaneous redemptions only one flips consumedAt. False means the
// token was already used or has expired.
const consume = async (id: string, now: Date, db: Db = prisma): Promise<boolean> => {
  try {
    const { count } = await db.userToken.updateMany({
      where: { id, consumedAt: null, expiresAt: { gt: now } },
      data: { consumedAt: now },
    });
    return count === 1;
  } catch (error) {
    throw error;
  }
};

// Voids every unused token of the user (of one purpose, or all): a new link replaces the old
// one, and a deactivated or reset account must not be reachable through a link issued earlier.
const invalidateOutstanding = async (
  userId: string,
  purpose?: UserTokenPurpose,
  db: Db = prisma
): Promise<void> => {
  try {
    await db.userToken.updateMany({
      where: { userId, consumedAt: null, ...(purpose ? { purpose } : {}) },
      data: { consumedAt: new Date() },
    });
  } catch (error) {
    throw error;
  }
};

const purgeExpired = async (olderThan: Date): Promise<number> => {
  try {
    const { count } = await prisma.userToken.deleteMany({ where: { expiresAt: { lt: olderThan } } });
    return count;
  } catch (error) {
    throw error;
  }
};

export const UserTokenQuery = {
  inTransaction,
  create,
  findByHash,
  findLatest,
  consume,
  invalidateOutstanding,
  purgeExpired,
};
