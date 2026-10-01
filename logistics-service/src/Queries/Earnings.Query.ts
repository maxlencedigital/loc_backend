import type { Prisma } from "@prisma/client";
import { prisma } from "../DB/Prisma.Connection.Db.js";
import {
  ICashTotals,
  IFieldPayment,
  IFieldPaymentCreate,
  IFieldPaymentFilter,
  ILedgerEntryCreate,
  LedgerKind,
  LedgerTotals,
} from "../Models/Money/Money.Interface.js";
import type { Db, PageWindow } from "./Job.Query.js";

// ----------------------------------------------------------------------- ledger
// Append-only: this file has no update or delete for ledger rows, on purpose.

/** Inserts the entries that are new; an entry whose dedupeKey exists already is skipped (replay-safe). */
const addEntries = async (entries: ILedgerEntryCreate[], db: Db = prisma): Promise<number> => {
  try {
    if (entries.length === 0) return 0;
    const { count } = await db.ledgerEntry.createMany({ data: entries, skipDuplicates: true });
    return count;
  } catch (error) {
    throw error;
  }
};

/** Ledger sums by kind over a period, in one grouped query. */
const totals = async (riderId: string, range: { from: Date; to: Date }): Promise<LedgerTotals> => {
  try {
    const rows = await prisma.ledgerEntry.groupBy({
      by: ["kind"],
      where: { riderId, createdAt: { gte: range.from, lt: range.to } },
      _sum: { amountPaise: true },
    });
    return Object.fromEntries(rows.map((row) => [row.kind as LedgerKind, row._sum.amountPaise ?? 0]));
  } catch (error) {
    throw error;
  }
};

const shiftTotal = async (shiftId: string, db: Db = prisma): Promise<number> => {
  try {
    const result = await db.ledgerEntry.aggregate({ where: { shiftId }, _sum: { amountPaise: true } });
    return result._sum.amountPaise ?? 0;
  } catch (error) {
    throw error;
  }
};

// ------------------------------------------------------------- field payments

const createFieldPayment = async (data: IFieldPaymentCreate, db: Db = prisma): Promise<IFieldPayment> => {
  try {
    return (await db.fieldPayment.create({ data })) as IFieldPayment;
  } catch (error) {
    throw error;
  }
};

const findFieldPaymentByKey = async (riderId: string, idempotencyKey: string): Promise<IFieldPayment | null> => {
  try {
    return (await prisma.fieldPayment.findUnique({
      where: { riderId_idempotencyKey: { riderId, idempotencyKey } },
    })) as IFieldPayment | null;
  } catch (error) {
    throw error;
  }
};

const findFieldPaymentById = async (id: string): Promise<IFieldPayment | null> => {
  try {
    return (await prisma.fieldPayment.findUnique({ where: { id } })) as IFieldPayment | null;
  } catch (error) {
    throw error;
  }
};

const listFieldPayments = async (
  filter: IFieldPaymentFilter,
  page: PageWindow
): Promise<{ items: IFieldPayment[]; total: number }> => {
  try {
    const where: Prisma.FieldPaymentWhereInput = {
      ...(filter.storeId ? { storeId: filter.storeId } : {}),
      ...(filter.riderId ? { riderId: filter.riderId } : {}),
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.from || filter.to
        ? { collectedAt: { ...(filter.from ? { gte: filter.from } : {}), ...(filter.to ? { lt: filter.to } : {}) } }
        : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.fieldPayment.findMany({ where, orderBy: [{ collectedAt: "desc" }, { id: "asc" }], skip: page.offset, take: page.limit }),
      prisma.fieldPayment.count({ where }),
    ]);
    return { items: rows as IFieldPayment[], total };
  } catch (error) {
    throw error;
  }
};

/** Settles only a payment still waiting to be handed over; false means it was settled already. */
const settleFieldPayment = async (
  id: string,
  data: { settledAmountPaise: number; settledByUserId: string | null; settledStoreId: string | null; settleNote: string | null },
  db: Db = prisma
): Promise<boolean> => {
  try {
    const { count } = await db.fieldPayment.updateMany({
      where: { id, status: "collected" },
      data: { ...data, status: "settled", settledAt: new Date() },
    });
    return count === 1;
  } catch (error) {
    throw error;
  }
};

/** Cash only: card and UPI never have to be handed over. */
const cashTotals = async (riderId: string): Promise<ICashTotals> => {
  try {
    const rows = await prisma.fieldPayment.groupBy({
      by: ["status"],
      where: { riderId, method: "cash" },
      _sum: { amountPaise: true },
    });
    const sum = (status: string) => rows.find((row) => row.status === status)?._sum.amountPaise ?? 0;
    return { collectedPaise: sum("collected") + sum("settled"), settledPaise: sum("settled") };
  } catch (error) {
    throw error;
  }
};

export const EarningsQuery = {
  addEntries,
  totals,
  shiftTotal,
  createFieldPayment,
  findFieldPaymentByKey,
  findFieldPaymentById,
  listFieldPayments,
  settleFieldPayment,
  cashTotals,
};
