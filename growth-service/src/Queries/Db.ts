import type { Prisma } from "@prisma/client";
import { prisma } from "../DB/Prisma.Connection.Db.js";

// A query accepts the transaction it runs in, so a multi-row change commits or rolls back whole.
export type Db = Prisma.TransactionClient;

export const inTransaction = async <T>(work: (tx: Db) => Promise<T>): Promise<T> => {
  try {
    return await prisma.$transaction(work, { maxWait: 5_000, timeout: 20_000 });
  } catch (error) {
    throw error;
  }
};
