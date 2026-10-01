import type { Prisma } from "@prisma/client";
import { prisma } from "../DB/Prisma.Connection.Db.js";
import type { ISlot, ISlotConfig, ISlotWindow } from "../Models/CustomerAccount/CustomerAccount.Interface.js";

export type Db = Prisma.TransactionClient;

const findConfig = async (storeId: string, db: Db = prisma): Promise<ISlotConfig | null> => {
  try {
    const row = await db.pickupSlotConfig.findUnique({
      where: { storeId },
      select: { slotMinutes: true, capacityPerSlot: true, leadMinutes: true, horizonDays: true },
    });
    return row;
  } catch (error) {
    throw error;
  }
};

// Creates the windows of a day that have no row yet. The unique (storeId, startsAt) makes
// two customers listing the same day at once harmless: the loser's inserts are skipped.
const ensureWindows = async (
  storeId: string,
  windows: ISlotWindow[],
  capacity: number,
  db: Db = prisma
): Promise<void> => {
  try {
    if (windows.length === 0) return;
    await db.pickupSlot.createMany({
      data: windows.map((w) => ({ storeId, startsAt: w.startsAt, endsAt: w.endsAt, capacity })),
      skipDuplicates: true,
    });
  } catch (error) {
    throw error;
  }
};

const listBetween = async (storeId: string, from: Date, to: Date, db: Db = prisma): Promise<ISlot[]> => {
  try {
    return await db.pickupSlot.findMany({
      where: { storeId, startsAt: { gte: from, lt: to } },
      orderBy: [{ startsAt: "asc" }],
    });
  } catch (error) {
    throw error;
  }
};

const findById = async (id: string, db: Db = prisma): Promise<ISlot | null> => {
  try {
    return await db.pickupSlot.findUnique({ where: { id } });
  } catch (error) {
    throw error;
  }
};

// One conditional UPDATE: the row lock and the capacity test are the same statement, so
// the last place can only be taken once. False means the slot is full.
const reserve = async (id: string, db: Db): Promise<boolean> => {
  try {
    const { count } = await db.pickupSlot.updateMany({
      where: { id, booked: { lt: db.pickupSlot.fields.capacity } },
      data: { booked: { increment: 1 } },
    });
    return count > 0;
  } catch (error) {
    throw error;
  }
};

const release = async (id: string, db: Db): Promise<void> => {
  try {
    await db.pickupSlot.updateMany({ where: { id, booked: { gt: 0 } }, data: { booked: { decrement: 1 } } });
  } catch (error) {
    throw error;
  }
};

const inTransaction = async <T>(work: (tx: Db) => Promise<T>): Promise<T> => {
  try {
    return await prisma.$transaction(work);
  } catch (error) {
    throw error;
  }
};

export const PickupSlotQuery = { inTransaction, findConfig, ensureWindows, listBetween, findById, reserve, release };
