import type { Prisma } from "@prisma/client";
import { prisma } from "../DB/Prisma.Connection.Db.js";
import { IHoliday, IHolidayCreate } from "../Models/Hr/Leave.Interface.js";
import type { Db } from "./Hr.Transaction.js";

const MAX_RANGE_ROWS = 500;

// undefined: every holiday. null: only those that close everyone. A store id: those
// plus the ones that close that store.
export type HolidayAudience = string | null | undefined;

const audienceWhere = (audience: HolidayAudience): Prisma.HrHolidayWhereInput => {
  if (audience === undefined) return {};
  if (audience === null) return { type: { not: "store" } };
  return { OR: [{ type: { not: "store" } }, { storeIds: { has: audience } }] };
};

const create = async (data: IHolidayCreate, db: Db = prisma): Promise<IHoliday> => {
  try {
    return await db.hrHoliday.create({ data });
  } catch (error) {
    throw error;
  }
};

const remove = async (id: string, db: Db = prisma): Promise<boolean> => {
  try {
    const { count } = await db.hrHoliday.deleteMany({ where: { id } });
    return count > 0;
  } catch (error) {
    throw error;
  }
};

const list = async (
  from: Date,
  to: Date,
  audience: HolidayAudience,
  offset: number,
  limit: number,
  db: Db = prisma
): Promise<{ items: IHoliday[]; total: number }> => {
  try {
    const where: Prisma.HrHolidayWhereInput = { date: { gte: from, lte: to }, ...audienceWhere(audience) };
    const [items, total] = await Promise.all([
      db.hrHoliday.findMany({
        where,
        orderBy: [{ date: "asc" }, { id: "asc" }],
        skip: offset,
        take: limit,
        select: { id: true, date: true, name: true, type: true, storeIds: true },
      }),
      db.hrHoliday.count({ where }),
    ]);
    return { items, total };
  } catch (error) {
    throw error;
  }
};

/** Every holiday in a bounded date range, for leave-day arithmetic. */
const inRange = async (from: Date, to: Date, db: Db = prisma): Promise<IHoliday[]> => {
  try {
    return await db.hrHoliday.findMany({
      where: { date: { gte: from, lte: to } },
      orderBy: { date: "asc" },
      take: MAX_RANGE_ROWS,
      select: { id: true, date: true, name: true, type: true, storeIds: true },
    });
  } catch (error) {
    throw error;
  }
};

export const HolidayQuery = { create, remove, list, inRange };
