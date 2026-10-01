import type { Prisma } from "@prisma/client";
import { prisma } from "../DB/Prisma.Connection.Db.js";
import {
  IAverage,
  IFeedback,
  IFeedbackCreate,
  IFeedbackFilter,
  IFeedbackPageFilter,
  IFeedbackSummary,
} from "../Models/Feedback/Feedback.Interface.js";

export type Db = Prisma.TransactionClient;

// Rows shown in the summary's by-store, by-rider and trend sections are capped, so a long
// history never turns one dashboard call into an unbounded result.
export const MAX_STORE_ROWS = 200;
export const MAX_RIDER_ROWS = 100;
export const MAX_TREND_DAYS = 366;

const round = (value: number | null): number | null => (value === null ? null : Math.round(value * 100) / 100);

const where = (filter: IFeedbackFilter): Prisma.OrderFeedbackWhereInput => ({
  ...(filter.storeId ? { storeId: filter.storeId } : {}),
  ...(filter.riderId ? { riderId: filter.riderId } : {}),
  ...(filter.rating ? { rating: filter.rating } : {}),
  ...(filter.from || filter.to ? { createdAt: { gte: filter.from, lte: filter.to } } : {}),
});

const create = async (data: IFeedbackCreate, db: Db = prisma): Promise<IFeedback> => {
  try {
    return await db.orderFeedback.create({ data });
  } catch (error) {
    throw error;
  }
};

const findByOrderAndCustomer = async (
  orderId: string,
  customerUserId: string,
  db: Db = prisma
): Promise<IFeedback | null> => {
  try {
    return await db.orderFeedback.findUnique({ where: { orderId_customerUserId: { orderId, customerUserId } } });
  } catch (error) {
    throw error;
  }
};

const search = async (
  filter: IFeedbackPageFilter,
  db: Db = prisma
): Promise<{ items: IFeedback[]; total: number }> => {
  try {
    const clause = where(filter);
    const [items, total] = await Promise.all([
      db.orderFeedback.findMany({
        where: clause,
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        skip: filter.page.offset,
        take: filter.page.limit,
      }),
      db.orderFeedback.count({ where: clause }),
    ]);
    return { items, total };
  } catch (error) {
    throw error;
  }
};

// Every figure is a SQL aggregate over the filtered rows; no feedback row is loaded.
// `trendFrom` is the first day of the trend, already clamped by the service.
const summarise = async (
  filter: IFeedbackFilter,
  trendFrom: Date | undefined,
  db: Db = prisma
): Promise<IFeedbackSummary> => {
  try {
    const clause = where(filter);
    const [overall, byRating, byStore, byRider, byDay] = await Promise.all([
      db.orderFeedback.aggregate({ where: clause, _avg: { rating: true }, _count: { _all: true } }),
      db.orderFeedback.groupBy({ by: ["rating"], where: clause, _count: { _all: true } }),
      db.orderFeedback.groupBy({
        by: ["storeId"],
        where: clause,
        _avg: { rating: true },
        _count: { _all: true },
        orderBy: [{ _count: { storeId: "desc" } }, { storeId: "asc" }],
        take: MAX_STORE_ROWS,
      }),
      // A rider is judged on the rating the customer gave the rider, not on the order overall.
      db.orderFeedback.groupBy({
        by: ["riderId"],
        where: { ...clause, riderId: { not: null }, riderRating: { not: null } },
        _avg: { riderRating: true },
        _count: { riderRating: true },
        orderBy: [{ _count: { riderRating: "desc" } }, { riderId: "asc" }],
        take: MAX_RIDER_ROWS,
      }),
      db.orderFeedback.groupBy({
        by: ["ratedOn"],
        where: trendFrom ? { ...clause, ratedOn: { gte: trendFrom } } : clause,
        _avg: { rating: true },
        _count: { _all: true },
        orderBy: { ratedOn: "asc" },
        take: MAX_TREND_DAYS,
      }),
    ]);

    const average = (avg: number | null, count: number): IAverage => ({ average: round(avg), count });
    const distribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    for (const group of byRating) distribution[group.rating] = group._count._all;

    return {
      overall: average(overall._avg.rating, overall._count._all),
      distribution,
      byStore: byStore.map((g) => ({ storeId: g.storeId, ...average(g._avg.rating, g._count._all) })),
      byRider: byRider.map((g) => ({
        riderId: g.riderId as string,
        ...average(g._avg.riderRating, g._count.riderRating),
      })),
      trend: byDay.map((g) => ({ date: g.ratedOn.toISOString().slice(0, 10), ...average(g._avg.rating, g._count._all) })),
    };
  } catch (error) {
    throw error;
  }
};

export const FeedbackQuery = { create, findByOrderAndCustomer, search, summarise };
