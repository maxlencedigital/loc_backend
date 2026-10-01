import { prisma } from "../DB/Prisma.Connection.Db.js";
import { IRoster, IRosterCreate, IRosterFilter, IShiftCount } from "../Models/Hr/Attendance.Interface.js";
import type { Db } from "./Hr.Transaction.js";

const create = async (data: IRosterCreate, db: Db): Promise<IRoster> => {
  try {
    const { createdByUserId: _by, createdAt: _at, ...row } = (await db.hrRoster.create({ data })) as IRoster & {
      createdByUserId: string | null;
      createdAt: Date;
    };
    return row;
  } catch (error) {
    throw error;
  }
};

// Shifts of one employee that overlap [startMin, endMin) on a date.
const findOverlapping = async (
  employeeId: string,
  date: Date,
  startMin: number,
  endMin: number,
  db: Db = prisma
): Promise<number> => {
  try {
    return await db.hrRoster.count({
      where: { employeeId, date, shiftStartMin: { lt: endMin }, shiftEndMin: { gt: startMin } },
    });
  } catch (error) {
    throw error;
  }
};

const findById = async (id: string, scope: string | null, db: Db = prisma): Promise<IRoster | null> => {
  try {
    return await db.hrRoster.findFirst({
      where: { id, ...(scope ? { storeId: scope } : {}) },
      select: { id: true, employeeId: true, storeId: true, date: true, shiftStartMin: true, shiftEndMin: true },
    });
  } catch (error) {
    throw error;
  }
};

const remove = async (id: string, db: Db = prisma): Promise<void> => {
  try {
    await db.hrRoster.deleteMany({ where: { id } });
  } catch (error) {
    throw error;
  }
};

const list = async (filter: IRosterFilter, db: Db = prisma): Promise<{ items: IRoster[]; total: number }> => {
  try {
    const where = {
      ...(filter.storeId ? { storeId: filter.storeId } : {}),
      ...(filter.from || filter.to ? { date: { gte: filter.from, lte: filter.to } } : {}),
    };
    const [items, total] = await Promise.all([
      db.hrRoster.findMany({
        where,
        orderBy: [{ date: "asc" }, { shiftStartMin: "asc" }, { id: "asc" }],
        skip: filter.offset,
        take: filter.limit,
        select: { id: true, employeeId: true, storeId: true, date: true, shiftStartMin: true, shiftEndMin: true },
      }),
      db.hrRoster.count({ where }),
    ]);
    return { items, total };
  } catch (error) {
    throw error;
  }
};

// Earliest shift start of one employee on a date, to judge a clock-in as late or not.
const firstShiftStart = async (employeeId: string, date: Date, db: Db = prisma): Promise<number | null> => {
  try {
    const row = await db.hrRoster.findFirst({
      where: { employeeId, date },
      orderBy: { shiftStartMin: "asc" },
      select: { shiftStartMin: true },
    });
    return row?.shiftStartMin ?? null;
  } catch (error) {
    throw error;
  }
};

// Headcount per (date, shift) for one store over the given dates, aggregated in SQL.
const shiftCounts = async (storeId: string, dates: Date[], db: Db = prisma): Promise<IShiftCount[]> => {
  try {
    if (dates.length === 0) return [];
    const groups = await db.hrRoster.groupBy({
      by: ["date", "shiftStartMin", "shiftEndMin"],
      where: { storeId, date: { in: dates } },
      _count: { _all: true },
    });
    return groups.map((g) => ({
      date: g.date,
      shiftStartMin: g.shiftStartMin,
      shiftEndMin: g.shiftEndMin,
      rostered: g._count._all,
    }));
  } catch (error) {
    throw error;
  }
};

export const RosterQuery = { create, findOverlapping, findById, remove, list, firstShiftStart, shiftCounts };
