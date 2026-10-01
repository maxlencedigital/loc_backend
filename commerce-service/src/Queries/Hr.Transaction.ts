import type { Prisma } from "@prisma/client";
import { prisma } from "../DB/Prisma.Connection.Db.js";

export type Db = Prisma.TransactionClient;

// One transaction spans several HR Query modules (an employee change plus its history,
// a leave decision plus its balance and ledger), so the helper lives apart from them.
export const inHrTransaction = async <T>(work: (tx: Db) => Promise<T>): Promise<T> => {
  try {
    return await prisma.$transaction(work);
  } catch (error) {
    throw error;
  }
};
