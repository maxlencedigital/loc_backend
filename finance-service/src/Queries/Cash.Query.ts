import type { Prisma } from "@prisma/client";
import { PageRequest } from "../../commons/Utils/Pagination.js";
import { prisma } from "../DB/Prisma.Connection.Db.js";
import { dayToDate } from "../Utils/Dates.js";
import { ICashTotals, ICashVariance, IDailyClose, IDailyCloseCreate } from "../Models/Cash/Cash.Interface.js";
import { Db, toDay } from "./Db.js";

type CloseRow = Prisma.DailyCloseGetPayload<object>;
const toClose = (row: CloseRow): IDailyClose => ({ ...row, date: toDay(row.date) });

type VarianceRow = Prisma.CashVarianceGetPayload<object>;
const toVariance = (row: VarianceRow): ICashVariance => ({ ...row, date: toDay(row.date) });

// The DAILY_VIEW_LIMIT bounds the per-day store listing; no business has thousands of stores.
export const DAILY_VIEW_LIMIT = 500;

/**
 * Records a store's day close. False means that store and day were already closed and nothing
 * was written (unique store+day), which is how a repeated call from commerce is a no-op.
 */
const insertClose = async (data: IDailyCloseCreate, db: Db): Promise<boolean> => {
  try {
    const { count } = await db.dailyClose.createMany({
      data: [
        {
          storeId: data.storeId,
          storeName: data.storeName,
          date: dayToDate(data.date),
          expectedPaise: data.expectedPaise,
          closedByUserId: data.closedByUserId,
          closedByName: data.closedByName,
        },
      ],
      skipDuplicates: true,
    });
    return count === 1;
  } catch (error) {
    throw error;
  }
};

const findClose = async (storeId: string, date: string, db: Db = prisma): Promise<IDailyClose | null> => {
  try {
    const row = await db.dailyClose.findUnique({ where: { storeId_date: { storeId, date: dayToDate(date) } } });
    return row ? toClose(row) : null;
  } catch (error) {
    throw error;
  }
};

const findCloseById = async (id: string, storeScope: string | null, db: Db = prisma): Promise<IDailyClose | null> => {
  try {
    const row = await db.dailyClose.findFirst({ where: { id, ...(storeScope ? { storeId: storeScope } : {}) } });
    return row ? toClose(row) : null;
  } catch (error) {
    throw error;
  }
};

const searchCloses = async (
  filter: { date?: string; storeId?: string | null },
  page: PageRequest
): Promise<{ items: IDailyClose[]; total: number }> => {
  try {
    const where: Prisma.DailyCloseWhereInput = {
      ...(filter.date ? { date: dayToDate(filter.date) } : {}),
      ...(filter.storeId ? { storeId: filter.storeId } : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.dailyClose.findMany({
        where,
        orderBy: [{ date: "desc" }, { storeId: "asc" }],
        skip: page.offset,
        take: page.limit,
      }),
      prisma.dailyClose.count({ where }),
    ]);
    return { items: rows.map(toClose), total };
  } catch (error) {
    throw error;
  }
};

const closesForDate = async (date: string, storeId: string | null): Promise<IDailyClose[]> => {
  try {
    const rows = await prisma.dailyClose.findMany({
      where: { date: dayToDate(date), ...(storeId ? { storeId } : {}) },
      orderBy: { storeId: "asc" },
      take: DAILY_VIEW_LIMIT,
    });
    return rows.map(toClose);
  } catch (error) {
    throw error;
  }
};

// A no-op UPDATE takes the row lock, so two deposits for one day are checked one after the other.
const lockClose = async (storeId: string, date: string, db: Db): Promise<IDailyClose | null> => {
  try {
    await db.dailyClose.updateMany({ where: { storeId, date: dayToDate(date) }, data: { updatedAt: new Date() } });
    return await findClose(storeId, date, db);
  } catch (error) {
    throw error;
  }
};

/** Guarded: only a day still in "closed" can be approved; false means it already was. */
const approveClose = async (id: string, approverId: string, note: string | null, db: Db = prisma): Promise<boolean> => {
  try {
    const { count } = await db.dailyClose.updateMany({
      where: { id, status: "closed" },
      data: { status: "approved", approvedByUserId: approverId, approvedAt: new Date(), approvalNote: note },
    });
    return count === 1;
  } catch (error) {
    throw error;
  }
};

/** Appends to the cash book. False: this idempotency key was already used for the store (a replay). */
const addEntry = async (
  data: {
    storeId: string;
    date: string;
    kind: "counted" | "deposit";
    amountPaise: number;
    reference: string | null;
    idempotencyKey: string;
  },
  db: Db = prisma
): Promise<boolean> => {
  try {
    const { count } = await db.cashBookEntry.createMany({
      data: [{ ...data, date: dayToDate(data.date) }],
      skipDuplicates: true,
    });
    return count === 1;
  } catch (error) {
    throw error;
  }
};

const hasEntry = async (storeId: string, kind: "counted" | "deposit", idempotencyKey: string, db: Db = prisma): Promise<boolean> => {
  try {
    return (await db.cashBookEntry.count({ where: { storeId, kind, idempotencyKey } })) > 0;
  } catch (error) {
    throw error;
  }
};

const totalsForDate = async (date: string, storeId: string | null, db: Db = prisma): Promise<ICashTotals[]> => {
  try {
    const groups = await db.cashBookEntry.groupBy({
      by: ["storeId", "kind"],
      where: { date: dayToDate(date), ...(storeId ? { storeId } : {}) },
      _sum: { amountPaise: true },
    });
    const byStore = new Map<string, ICashTotals>();
    for (const group of groups) {
      const totals = byStore.get(group.storeId) ?? { storeId: group.storeId, countedPaise: 0, bankedPaise: 0 };
      const sum = Number(group._sum.amountPaise ?? 0);
      if (group.kind === "counted") totals.countedPaise += sum;
      else totals.bankedPaise += sum;
      byStore.set(group.storeId, totals);
    }
    return [...byStore.values()];
  } catch (error) {
    throw error;
  }
};

const openVariance = async (
  data: { storeId: string; date: string; amountPaise: number },
  db: Db
): Promise<void> => {
  try {
    await db.cashVariance.createMany({ data: [{ ...data, date: dayToDate(data.date) }], skipDuplicates: true });
  } catch (error) {
    throw error;
  }
};

const findVariance = async (storeId: string, date: string, db: Db = prisma): Promise<ICashVariance | null> => {
  try {
    const row = await db.cashVariance.findUnique({ where: { storeId_date: { storeId, date: dayToDate(date) } } });
    return row ? toVariance(row) : null;
  } catch (error) {
    throw error;
  }
};

const findVarianceById = async (id: string, storeScope: string | null, db: Db = prisma): Promise<ICashVariance | null> => {
  try {
    const row = await db.cashVariance.findFirst({ where: { id, ...(storeScope ? { storeId: storeScope } : {}) } });
    return row ? toVariance(row) : null;
  } catch (error) {
    throw error;
  }
};

const searchVariances = async (
  filter: { storeId?: string | null; resolved?: boolean; from?: string; to?: string },
  page: PageRequest
): Promise<{ items: ICashVariance[]; total: number }> => {
  try {
    const where: Prisma.CashVarianceWhereInput = {
      ...(filter.storeId ? { storeId: filter.storeId } : {}),
      ...(filter.resolved === undefined ? {} : { status: filter.resolved ? "resolved" : "open" }),
      ...(filter.from || filter.to
        ? {
            date: {
              ...(filter.from ? { gte: dayToDate(filter.from) } : {}),
              ...(filter.to ? { lte: dayToDate(filter.to) } : {}),
            },
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.cashVariance.findMany({
        where,
        orderBy: [{ date: "desc" }, { storeId: "asc" }],
        skip: page.offset,
        take: page.limit,
      }),
      prisma.cashVariance.count({ where }),
    ]);
    return { items: rows.map(toVariance), total };
  } catch (error) {
    throw error;
  }
};

/** Guarded: resolves a variance only while it is open; false means it was already resolved. */
const resolveVariance = async (
  id: string,
  data: { resolution: string; note: string | null; resolvedByUserId: string }
): Promise<boolean> => {
  try {
    const { count } = await prisma.cashVariance.updateMany({
      where: { id, status: "open" },
      data: { ...data, status: "resolved", resolvedAt: new Date() },
    });
    return count === 1;
  } catch (error) {
    throw error;
  }
};

/** Sum of day-close expected cash and cash-book totals over a window, for the dashboard. */
const summarise = async (
  from: string,
  to: string,
  storeId: string | null
): Promise<{ expectedPaise: number; countedPaise: number; bankedPaise: number }> => {
  try {
    const dates = { gte: dayToDate(from), lte: dayToDate(to) };
    const store = storeId ? { storeId } : {};
    const [expected, entries] = await Promise.all([
      prisma.dailyClose.aggregate({ where: { date: dates, ...store }, _sum: { expectedPaise: true } }),
      prisma.cashBookEntry.groupBy({ by: ["kind"], where: { date: dates, ...store }, _sum: { amountPaise: true } }),
    ]);
    const sumOf = (kind: string) => Number(entries.find((e) => e.kind === kind)?._sum.amountPaise ?? 0);
    return {
      expectedPaise: Number(expected._sum.expectedPaise ?? 0),
      countedPaise: sumOf("counted"),
      bankedPaise: sumOf("deposit"),
    };
  } catch (error) {
    throw error;
  }
};

export const CashQuery = {
  insertClose,
  findClose,
  findCloseById,
  searchCloses,
  closesForDate,
  lockClose,
  approveClose,
  addEntry,
  hasEntry,
  totalsForDate,
  openVariance,
  findVariance,
  findVarianceById,
  searchVariances,
  resolveVariance,
  summarise,
};
