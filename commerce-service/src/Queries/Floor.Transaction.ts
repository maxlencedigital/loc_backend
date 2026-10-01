import type { Prisma } from "@prisma/client";
import { prisma } from "../DB/Prisma.Connection.Db.js";

export type Db = Prisma.TransactionClient;

// One transaction for everything a floor action changes (pieces, batch, machine and the
// order status it drives), so a half-applied batch start is impossible.
const run = async <T>(work: (tx: Db) => Promise<T>): Promise<T> => {
  try {
    return await prisma.$transaction(work);
  } catch (error) {
    throw error;
  }
};

export const FloorTransaction = { run };
