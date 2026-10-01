import type { Prisma } from "@prisma/client";
import { Page, PageRequest, toPage } from "../../commons/Utils/Pagination.js";
import { prisma } from "../DB/Prisma.Connection.Db.js";
import {
  ICashCount,
  ICashCountCreate,
  ICashDeposit,
  ICashDepositCreate,
  ICashVariance,
  IDayClose,
  IDayTotals,
  IStoreDay,
  VarianceStatus,
} from "../Models/StoreAdmin/StoreAdmin.Interface.js";
import { fromDbDate, istDayStart, istNextDayStart, toDbDate } from "../Utils/StoreAdminInput.js";

export type Db = Prisma.TransactionClient;

type DayRow = Prisma.StoreDayGetPayload<object>;
type CountRow = Prisma.CashCountGetPayload<object>;

const toDay = (row: DayRow): IStoreDay => ({
  id: row.id,
  storeId: row.storeId,
  date: fromDbDate(row.date),
  state: row.state as IStoreDay["state"],
  closedAt: row.closedAt,
  closedByName: row.closedByName,
  closeNote: row.closeNote,
  closedExpectedPaise: row.closedExpectedPaise,
  closedCountedPaise: row.closedCountedPaise,
  closedVariancePaise: row.closedVariancePaise,
});

const toCount = (row: CountRow): ICashCount => ({
  id: row.id,
  storeId: row.storeId,
  date: fromDbDate(row.date),
  countedPaise: row.countedPaise,
  expectedPaise: row.expectedPaise,
  variancePaise: row.variancePaise,
  denominations: row.denominations as Record<string, number> | null,
  note: row.note,
  countedByName: row.countedByName,
  createdAt: row.createdAt,
});

const inTransaction = async <T>(work: (tx: Db) => Promise<T>): Promise<T> => {
  try {
    return await prisma.$transaction(work);
  } catch (error) {
    throw error;
  }
};

const findDay = async (storeId: string, date: string, db: Db = prisma): Promise<IStoreDay | null> => {
  try {
    const row = await db.storeDay.findUnique({ where: { storeId_date: { storeId, date: toDbDate(date) } } });
    return row ? toDay(row) : null;
  } catch (error) {
    throw error;
  }
};

// Creates the day row if needed, then takes its row lock with a no-op UPDATE until the
// transaction ends: counts, deposits and the close of one day queue behind each other.
const lockDay = async (storeId: string, date: string, db: Db): Promise<IStoreDay> => {
  try {
    const day = toDbDate(date);
    await db.storeDay.createMany({ data: [{ storeId, date: day }], skipDuplicates: true });
    await db.storeDay.updateMany({ where: { storeId, date: day }, data: { updatedAt: new Date() } });
    return toDay(await db.storeDay.findUniqueOrThrow({ where: { storeId_date: { storeId, date: day } } }));
  } catch (error) {
    throw error;
  }
};

// Cash the system expects for a business day: orders booked over the counter and marked paid.
// The orders table records no payment method or paid amount, so this is the best available
// proxy (see the module note for its limits).
const sumCashSales = async (storeId: string, date: string, db: Db = prisma): Promise<number> => {
  try {
    const result = await db.order.aggregate({
      where: {
        storeId,
        placedAt: { gte: istDayStart(date), lt: istNextDayStart(date) },
        channel: "walk_in",
        paymentStatus: "paid",
        status: { not: "cancelled" },
      },
      _sum: { amountPaise: true },
    });
    return result._sum.amountPaise ?? 0;
  } catch (error) {
    throw error;
  }
};

const latestCount = async (storeId: string, date: string, db: Db = prisma): Promise<ICashCount | null> => {
  try {
    const row = await db.cashCount.findFirst({
      where: { storeId, date: toDbDate(date) },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    return row ? toCount(row) : null;
  } catch (error) {
    throw error;
  }
};

const dayTotals = async (storeId: string, date: string, db: Db = prisma): Promise<IDayTotals> => {
  try {
    const deposits = await db.cashDeposit.aggregate({
      where: { storeId, date: toDbDate(date) },
      _sum: { amountPaise: true },
      _count: { _all: true },
    });
    return {
      latestCount: await latestCount(storeId, date, db),
      depositedPaise: deposits._sum.amountPaise ?? 0,
      depositCount: deposits._count._all,
    };
  } catch (error) {
    throw error;
  }
};

// Writes the count, retires the day's earlier variances, raises a new one if it does not
// match, and marks the day counted. The caller holds the day lock.
const createCount = async (data: ICashCountCreate, db: Db): Promise<ICashCount> => {
  try {
    const date = toDbDate(data.date);
    const variancePaise = data.countedPaise - data.expectedPaise;
    const row = await db.cashCount.create({
      data: {
        storeId: data.storeId,
        date,
        countedPaise: data.countedPaise,
        expectedPaise: data.expectedPaise,
        variancePaise,
        denominations: data.denominations ?? undefined,
        note: data.note,
        countedByUserId: data.countedByUserId,
        countedByName: data.countedByName,
      },
    });
    await db.cashVariance.updateMany({
      where: { storeId: data.storeId, date, status: "open" },
      data: { status: "resolved", resolvedAt: new Date(), note: "Superseded by a recount." },
    });
    if (variancePaise !== 0) {
      await db.cashVariance.create({
        data: { storeId: data.storeId, date, countId: row.id, amountPaise: variancePaise },
      });
    }
    await db.storeDay.updateMany({ where: { storeId: data.storeId, date, state: "open" }, data: { state: "counted" } });
    return toCount(row);
  } catch (error) {
    throw error;
  }
};

const createDeposit = async (data: ICashDepositCreate, db: Db): Promise<ICashDeposit> => {
  try {
    const row = await db.cashDeposit.create({ data: { ...data, date: toDbDate(data.date) } });
    return { ...row, date: fromDbDate(row.date) };
  } catch (error) {
    throw error;
  }
};

const listCounts = async (storeId: string, from: string, to: string, page: PageRequest): Promise<Page<ICashCount>> => {
  try {
    const where = { storeId, date: { gte: toDbDate(from), lte: toDbDate(to) } };
    const [rows, total] = await Promise.all([
      prisma.cashCount.findMany({
        where,
        orderBy: [{ date: "desc" }, { createdAt: "desc" }, { id: "desc" }],
        skip: page.offset,
        take: page.limit,
      }),
      prisma.cashCount.count({ where }),
    ]);
    return toPage(rows.map(toCount), total, page);
  } catch (error) {
    throw error;
  }
};

const listDeposits = async (storeId: string, start: Date, end: Date, page: PageRequest): Promise<Page<ICashDeposit>> => {
  try {
    const where = { storeId, depositedAt: { gte: start, lt: end } };
    const [rows, total] = await Promise.all([
      prisma.cashDeposit.findMany({
        where,
        orderBy: [{ depositedAt: "desc" }, { id: "desc" }],
        skip: page.offset,
        take: page.limit,
      }),
      prisma.cashDeposit.count({ where }),
    ]);
    return toPage(rows.map((row) => ({ ...row, date: fromDbDate(row.date) })), total, page);
  } catch (error) {
    throw error;
  }
};

const toVariance = (row: Prisma.CashVarianceGetPayload<object>): ICashVariance => ({
  id: row.id,
  storeId: row.storeId,
  date: fromDbDate(row.date),
  amountPaise: row.amountPaise,
  status: row.status as VarianceStatus,
  note: row.note,
});

const listUnresolvedVariances = async (storeId: string, page: PageRequest): Promise<Page<ICashVariance>> => {
  try {
    const where = { storeId, status: { in: ["open", "explained"] } };
    const [rows, total] = await Promise.all([
      prisma.cashVariance.findMany({
        where,
        orderBy: [{ date: "desc" }, { createdAt: "desc" }, { id: "desc" }],
        skip: page.offset,
        take: page.limit,
      }),
      prisma.cashVariance.count({ where }),
    ]);
    return toPage(rows.map(toVariance), total, page);
  } catch (error) {
    throw error;
  }
};

// Net unresolved difference of a store over a date range (the overview's cashVariance).
const sumUnresolvedVariance = async (storeId: string, from: string, to: string, db: Db = prisma): Promise<number> => {
  try {
    const result = await db.cashVariance.aggregate({
      where: { storeId, status: { in: ["open", "explained"] }, date: { gte: toDbDate(from), lte: toDbDate(to) } },
      _sum: { amountPaise: true },
    });
    return result._sum.amountPaise ?? 0;
  } catch (error) {
    throw error;
  }
};

// Locks the day for good. The state guard makes a second close a no-op the caller can see.
const closeDay = async (dayId: string, storeId: string, date: string, close: IDayClose, db: Db): Promise<boolean> => {
  try {
    const { count } = await db.storeDay.updateMany({
      where: { id: dayId, state: { not: "closed" } },
      data: {
        state: "closed",
        closedAt: close.closedAt,
        closedByUserId: close.closedByUserId,
        closedByName: close.closedByName,
        closeNote: close.closeNote,
        closedExpectedPaise: close.expectedPaise,
        closedCountedPaise: close.countedPaise,
        closedVariancePaise: close.variancePaise,
      },
    });
    if (count === 0) return false;
    await db.cashVariance.updateMany({
      where: { storeId, date: toDbDate(date), status: "open" },
      data: { status: "explained", note: close.closeNote },
    });
    return true;
  } catch (error) {
    throw error;
  }
};

export const StoreCashQuery = {
  inTransaction,
  findDay,
  lockDay,
  sumCashSales,
  latestCount,
  dayTotals,
  createCount,
  createDeposit,
  listCounts,
  listDeposits,
  listUnresolvedVariances,
  sumUnresolvedVariance,
  closeDay,
};
