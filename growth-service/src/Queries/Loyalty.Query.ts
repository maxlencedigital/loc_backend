import type { Prisma } from "@prisma/client";
import { prisma } from "../DB/Prisma.Connection.Db.js";
import type { Db } from "./Db.js";
import type {
  ILoyaltyAccount,
  ILoyaltyProgram,
  ILoyaltyTier,
  ILoyaltyTransaction,
  ILoyaltyTransactionCreate,
  ILoyaltyTransactionFilter,
  LoyaltyTransactionType,
} from "../Models/Loyalty/Loyalty.Interface.js";

const getProgram = async (db: Db = prisma): Promise<ILoyaltyProgram | null> => {
  try {
    const row = await db.loyaltyProgram.findUnique({ where: { singleton: true } });
    return row
      ? { pointsPerRupeeMilli: row.pointsPerRupeeMilli, redemptionValuePaise: row.redemptionValuePaise, expiryDays: row.expiryDays }
      : null;
  } catch (error) {
    throw error;
  }
};

const listTiers = async (db: Db = prisma): Promise<ILoyaltyTier[]> => {
  try {
    const rows = await db.loyaltyTier.findMany({ orderBy: { minPoints: "asc" }, take: 20 });
    return rows.map((r) => ({ name: r.name, minPoints: r.minPoints, benefits: r.benefits }));
  } catch (error) {
    throw error;
  }
};

// Programme and tiers change together or not at all.
const saveProgram = async (program: ILoyaltyProgram, tiers: ILoyaltyTier[]): Promise<void> => {
  try {
    await prisma.$transaction([
      prisma.loyaltyProgram.upsert({ where: { singleton: true }, create: { ...program, singleton: true }, update: program }),
      prisma.loyaltyTier.deleteMany({}),
      prisma.loyaltyTier.createMany({ data: tiers }),
    ]);
  } catch (error) {
    throw error;
  }
};

const findAccount = async (customerId: string, db: Db = prisma): Promise<ILoyaltyAccount | null> => {
  try {
    return (await db.loyaltyAccount.findUnique({ where: { customerId } })) as ILoyaltyAccount | null;
  } catch (error) {
    throw error;
  }
};

// Creates the account if needed and takes its row lock until the transaction ends (a no-op
// UPDATE is the lock; raw FOR UPDATE would ignore the per-service schema).
const lockAccount = async (customerId: string, db: Db): Promise<ILoyaltyAccount> => {
  try {
    await db.loyaltyAccount.createMany({ data: [{ customerId }], skipDuplicates: true });
    await db.loyaltyAccount.updateMany({ where: { customerId }, data: { updatedAt: new Date() } });
    return (await db.loyaltyAccount.findUniqueOrThrow({ where: { customerId } })) as ILoyaltyAccount;
  } catch (error) {
    throw error;
  }
};

/** One conditional statement: a spend only applies while the balance covers it. */
const applyDelta = async (
  change: { customerId: string; delta: number; lifetimeDelta: number; earnedAt?: Date },
  db: Db
): Promise<boolean> => {
  try {
    const { count } = await db.loyaltyAccount.updateMany({
      where: { customerId: change.customerId, points: { gte: Math.max(0, -change.delta) } },
      data: {
        points: { increment: change.delta },
        lifetimePoints: { increment: change.lifetimeDelta },
        ...(change.earnedAt ? { lastEarnAt: change.earnedAt } : {}),
      },
    });
    return count === 1;
  } catch (error) {
    throw error;
  }
};

const insertTransaction = async (data: ILoyaltyTransactionCreate, db: Db): Promise<ILoyaltyTransaction> => {
  try {
    return (await db.loyaltyTransaction.create({ data })) as ILoyaltyTransaction;
  } catch (error) {
    throw error;
  }
};

const findTransaction = async (
  customerId: string,
  type: LoyaltyTransactionType,
  orderRef: string,
  db: Db = prisma
): Promise<ILoyaltyTransaction | null> => {
  try {
    return (await db.loyaltyTransaction.findUnique({
      where: { customerId_type_orderRef: { customerId, type, orderRef } },
    })) as ILoyaltyTransaction | null;
  } catch (error) {
    throw error;
  }
};

const listTransactions = async (
  filter: ILoyaltyTransactionFilter,
  paging: { offset: number; limit: number }
): Promise<{ items: ILoyaltyTransaction[]; total: number }> => {
  try {
    const where: Prisma.LoyaltyTransactionWhereInput = {
      ...(filter.customerId ? { customerId: filter.customerId } : {}),
      ...(filter.from || filter.to ? { createdAt: { ...(filter.from ? { gte: filter.from } : {}), ...(filter.to ? { lte: filter.to } : {}) } } : {}),
    };
    const [items, total] = await prisma.$transaction([
      prisma.loyaltyTransaction.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "asc" }], skip: paging.offset, take: paging.limit }),
      prisma.loyaltyTransaction.count({ where }),
    ]);
    return { items: items as ILoyaltyTransaction[], total };
  } catch (error) {
    throw error;
  }
};

/** Accounts with a balance whose last earn is older than the cutoff, oldest first. */
const listDormant = async (cutoff: Date, limit: number): Promise<ILoyaltyAccount[]> => {
  try {
    return (await prisma.loyaltyAccount.findMany({
      where: { points: { gt: 0 }, lastEarnAt: { lt: cutoff } },
      orderBy: { lastEarnAt: "asc" },
      take: limit,
    })) as ILoyaltyAccount[];
  } catch (error) {
    throw error;
  }
};

export const LoyaltyQuery = {
  getProgram,
  listTiers,
  saveProgram,
  findAccount,
  lockAccount,
  applyDelta,
  insertTransaction,
  findTransaction,
  listTransactions,
  listDormant,
};
