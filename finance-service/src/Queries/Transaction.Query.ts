import { prisma } from "../DB/Prisma.Connection.Db.js";
import type { Db } from "./Db.js";

// Services open a transaction here and pass the handle to each Query call that must join it.
const run = async <T>(work: (tx: Db) => Promise<T>): Promise<T> => {
  try {
    return await prisma.$transaction(work);
  } catch (error) {
    throw error;
  }
};

export const TransactionQuery = { run };
