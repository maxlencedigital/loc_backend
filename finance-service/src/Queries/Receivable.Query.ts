import type { Prisma } from "@prisma/client";
import { PageRequest } from "../../commons/Utils/Pagination.js";
import { prisma } from "../DB/Prisma.Connection.Db.js";
import { dayToDate } from "../Utils/Dates.js";
import {
  IAgingBucket,
  IReceivable,
  IReceivableContact,
  IReceivableCreate,
  IReceivableFilter,
  IReceivablePayment,
} from "../Models/Receivable/Receivable.Interface.js";
import { SpendMode } from "../Models/Expense/Expense.Interface.js";
import { Db, toDay } from "./Db.js";

// The contact columns are deliberately not selected here: only findContact reads them.
const COLUMNS = {
  id: true,
  invoiceId: true,
  customerId: true,
  storeId: true,
  orderRef: true,
  amountPaise: true,
  balancePaise: true,
  dueOn: true,
  lastRemindedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

type Row = Prisma.ReceivableGetPayload<{ select: typeof COLUMNS }>;
const toReceivable = (row: Row): IReceivable => ({ ...row, dueOn: toDay(row.dueOn) });

const whereOf = (filter: IReceivableFilter): Prisma.ReceivableWhereInput => {
  const today = dayToDate(filter.today);
  const status: Prisma.ReceivableWhereInput =
    filter.status === "paid"
      ? { balancePaise: 0 }
      : filter.status === "open"
        ? { balancePaise: { gt: 0 }, dueOn: { gte: today } }
        : filter.status === "overdue"
          ? { balancePaise: { gt: 0 }, dueOn: { lt: today } }
          : {};
  return {
    ...status,
    ...(filter.customerId ? { customerId: filter.customerId } : {}),
    ...(filter.storeId ? { storeId: filter.storeId } : {}),
    ...(filter.dueOnOrBefore
      ? { dueOn: { ...(status.dueOn as object | undefined), lte: dayToDate(filter.dueOnOrBefore) } }
      : {}),
  };
};

/** Creates the receivable for an invoice. False: it already exists (unique invoiceId), nothing written. */
const create = async (data: IReceivableCreate, db: Db = prisma): Promise<boolean> => {
  try {
    const { count } = await db.receivable.createMany({
      data: [{ ...data, balancePaise: data.amountPaise, dueOn: dayToDate(data.dueOn) }],
      skipDuplicates: true,
    });
    return count === 1;
  } catch (error) {
    throw error;
  }
};

const findById = async (id: string, storeScope: string | null, db: Db = prisma): Promise<IReceivable | null> => {
  try {
    const row = await db.receivable.findFirst({
      where: { id, ...(storeScope ? { storeId: storeScope } : {}) },
      select: COLUMNS,
    });
    return row ? toReceivable(row) : null;
  } catch (error) {
    throw error;
  }
};

const findByInvoice = async (invoiceId: string, db: Db = prisma): Promise<IReceivable | null> => {
  try {
    const row = await db.receivable.findUnique({ where: { invoiceId }, select: COLUMNS });
    return row ? toReceivable(row) : null;
  } catch (error) {
    throw error;
  }
};

const findContact = async (id: string): Promise<IReceivableContact | null> => {
  try {
    const row = await prisma.receivable.findUnique({ where: { id }, select: { contactPhone: true, contactEmail: true } });
    return row ? { phone: row.contactPhone, email: row.contactEmail } : null;
  } catch (error) {
    throw error;
  }
};

const search = async (filter: IReceivableFilter, page: PageRequest): Promise<{ items: IReceivable[]; total: number }> => {
  try {
    const where = whereOf(filter);
    const [rows, total] = await Promise.all([
      prisma.receivable.findMany({
        where,
        select: COLUMNS,
        orderBy: [{ dueOn: "asc" }, { id: "asc" }],
        skip: page.offset,
        take: page.limit,
      }),
      prisma.receivable.count({ where }),
    ]);
    return { items: rows.map(toReceivable), total };
  } catch (error) {
    throw error;
  }
};

/** Open balances due on or before a day and not reminded recently, with where to send the reminder. */
const listForReminders = async (
  dueOnOrBefore: string,
  remindedBefore: Date,
  limit: number
): Promise<Array<{ receivable: IReceivable; contact: IReceivableContact }>> => {
  try {
    const rows = await prisma.receivable.findMany({
      where: {
        balancePaise: { gt: 0 },
        dueOn: { lte: dayToDate(dueOnOrBefore) },
        OR: [{ lastRemindedAt: null }, { lastRemindedAt: { lt: remindedBefore } }],
      },
      select: { ...COLUMNS, contactPhone: true, contactEmail: true },
      orderBy: [{ dueOn: "asc" }, { id: "asc" }],
      take: limit,
    });
    return rows.map(({ contactPhone, contactEmail, ...row }) => ({
      receivable: toReceivable(row),
      contact: { phone: contactPhone, email: contactEmail },
    }));
  } catch (error) {
    throw error;
  }
};

/**
 * Takes `amountPaise` off the balance in one guarded statement: it only applies while the balance
 * still covers it, so two payments racing past the same balance cannot both succeed.
 */
const applyPayment = async (id: string, amountPaise: number, db: Db): Promise<boolean> => {
  try {
    const { count } = await db.receivable.updateMany({
      where: { id, balancePaise: { gte: amountPaise } },
      data: { balancePaise: { decrement: amountPaise } },
    });
    return count === 1;
  } catch (error) {
    throw error;
  }
};

const findPaymentByKey = async (receivableId: string, key: string, db: Db = prisma): Promise<IReceivablePayment | null> => {
  try {
    const row = await db.receivablePayment.findUnique({
      where: { receivableId_idempotencyKey: { receivableId, idempotencyKey: key } },
    });
    return row ? ({ ...row, mode: row.mode as SpendMode } as IReceivablePayment) : null;
  } catch (error) {
    throw error;
  }
};

const addPayment = async (
  data: {
    receivableId: string;
    storeId: string;
    amountPaise: number;
    mode: SpendMode;
    reference: string | null;
    idempotencyKey: string | null;
    recordedByUserId: string;
  },
  db: Db
): Promise<IReceivablePayment> => {
  try {
    return (await db.receivablePayment.create({ data })) as IReceivablePayment;
  } catch (error) {
    throw error;
  }
};

/** Logs each attempt (append-only) and stamps lastRemindedAt on the ones delivered, in one transaction. */
const recordReminders = async (
  rows: Array<{ id: string; channel: string; delivered: boolean; error: string | null }>,
  sentByUserId: string
): Promise<void> => {
  try {
    if (rows.length === 0) return;
    await prisma.$transaction([
      prisma.receivableReminder.createMany({
        data: rows.map((r) => ({
          receivableId: r.id,
          channel: r.channel,
          delivered: r.delivered,
          error: r.error,
          sentByUserId,
        })),
      }),
      prisma.receivable.updateMany({
        where: { id: { in: rows.filter((r) => r.delivered).map((r) => r.id) } },
        data: { lastRemindedAt: new Date() },
      }),
    ]);
  } catch (error) {
    throw error;
  }
};

const listPayments = async (receivableId: string, limit: number): Promise<IReceivablePayment[]> => {
  try {
    const rows = await prisma.receivablePayment.findMany({
      where: { receivableId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit,
    });
    return rows as IReceivablePayment[];
  } catch (error) {
    throw error;
  }
};

// Age is days past the due date. Five fixed buckets, one aggregate each: no rows are loaded.
const BUCKETS = [
  { label: "Not yet due", from: null, to: 0 },
  { label: "1-30 days", from: 1, to: 30 },
  { label: "31-60 days", from: 31, to: 60 },
  { label: "61-90 days", from: 61, to: 90 },
  { label: "Over 90 days", from: 91, to: null },
] as const;

const aging = async (today: string, storeId: string | null): Promise<IAgingBucket[]> => {
  try {
    const todayMs = dayToDate(today).getTime();
    const dayMs = 86_400_000;
    const results = await Promise.all(
      BUCKETS.map(async (bucket) => {
        // dueOn between (today - to) and (today - from); open-ended sides are omitted.
        const due: Prisma.DateTimeFilter = {};
        if (bucket.label === "Not yet due") due.gte = new Date(todayMs);
        else {
          if (bucket.to !== null) due.gte = new Date(todayMs - bucket.to * dayMs);
          if (bucket.from !== null) due.lte = new Date(todayMs - bucket.from * dayMs);
        }
        const sum = await prisma.receivable.aggregate({
          where: { balancePaise: { gt: 0 }, dueOn: due, ...(storeId ? { storeId } : {}) },
          _sum: { balancePaise: true },
          _count: { _all: true },
        });
        return { label: bucket.label, amountPaise: Number(sum._sum.balancePaise ?? 0), count: sum._count._all };
      })
    );
    return results;
  } catch (error) {
    throw error;
  }
};

export const ReceivableQuery = {
  create,
  findById,
  findByInvoice,
  findContact,
  search,
  listForReminders,
  applyPayment,
  findPaymentByKey,
  addPayment,
  recordReminders,
  listPayments,
  aging,
};
