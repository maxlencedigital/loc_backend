import type { Prisma } from "@prisma/client";
import { prisma } from "../DB/Prisma.Connection.Db.js";
import { dateToDay } from "../Utils/Dates.js";

// A query accepts the transaction it runs in, so related writes commit or roll back together.
export type Db = Prisma.TransactionClient;

export const inTransaction = async <T>(work: (tx: Db) => Promise<T>): Promise<T> => {
  try {
    return await prisma.$transaction(work);
  } catch (error) {
    throw error;
  }
};

/** Prisma returns DATE columns as UTC-midnight Dates; the domain speaks "YYYY-MM-DD". */
export const toDay = (value: Date): string => dateToDay(value);

