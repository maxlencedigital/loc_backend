import type { Prisma } from "@prisma/client";
import { prisma } from "../DB/Prisma.Connection.Db.js";

export type Db = Prisma.TransactionClient;

// Every ops write that touches more than one row (a change and its history row) runs here.
export const inTransaction = async <T>(work: (tx: Db) => Promise<T>): Promise<T> => {
  try {
    return await prisma.$transaction(work);
  } catch (error) {
    throw error;
  }
};

// A store-bound caller sees their store and the company-wide rows (no store); null sees all.
export const visibleStores = (scope: string | null): { OR?: { storeId: string | null }[] } =>
  scope ? { OR: [{ storeId: scope }, { storeId: null }] } : {};
