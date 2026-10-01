import type { Prisma } from "@prisma/client";
import { prisma } from "../DB/Prisma.Connection.Db.js";
import {
  IAttendance,
  IAttendanceCorrection,
  IAttendanceCorrectionCreate,
  IAttendanceCorrectionFilter,
  IAttendanceCount,
  IAttendanceWrite,
} from "../Models/Hr/Attendance.Interface.js";
import type { Db } from "./Hr.Transaction.js";

type AttendanceRow = Prisma.HrAttendanceGetPayload<object>;

const toAttendance = (row: AttendanceRow): IAttendance => ({
  id: row.id,
  employeeId: row.employeeId,
  storeId: row.storeId,
  date: row.date,
  status: row.status as IAttendance["status"],
  clockIn: row.clockIn,
  clockOut: row.clockOut,
  corrected: row.corrected,
});

const findDay = async (employeeId: string, date: Date, db: Db = prisma): Promise<IAttendance | null> => {
  try {
    const row = await db.hrAttendance.findUnique({ where: { employeeId_date: { employeeId, date } } });
    return row ? toAttendance(row) : null;
  } catch (error) {
    throw error;
  }
};

// The latest day still open (clocked in, not out) since the given instant: a rider's
// shift may run past midnight, so "today's row" alone is not enough.
const findOpen = async (employeeId: string, since: Date, db: Db = prisma): Promise<IAttendance | null> => {
  try {
    const row = await db.hrAttendance.findFirst({
      where: { employeeId, clockOut: null, clockIn: { gte: since } },
      orderBy: { date: "desc" },
    });
    return row ? toAttendance(row) : null;
  } catch (error) {
    throw error;
  }
};

const create = async (data: IAttendanceWrite, db: Db): Promise<IAttendance> => {
  try {
    return toAttendance(await db.hrAttendance.create({ data }));
  } catch (error) {
    throw error;
  }
};

const update = async (id: string, data: Partial<IAttendanceWrite>, db: Db): Promise<IAttendance> => {
  try {
    return toAttendance(await db.hrAttendance.update({ where: { id }, data }));
  } catch (error) {
    throw error;
  }
};

const listForEmployees = async (
  employeeIds: string[],
  from: Date,
  to: Date,
  db: Db = prisma
): Promise<IAttendance[]> => {
  try {
    if (employeeIds.length === 0) return [];
    const rows = await db.hrAttendance.findMany({
      where: { employeeId: { in: employeeIds }, date: { gte: from, lte: to } },
      orderBy: [{ date: "asc" }, { id: "asc" }],
    });
    return rows.map(toAttendance);
  } catch (error) {
    throw error;
  }
};

// SQL counts per employee: the summary never loads the day rows to count them.
const countByEmployee = async (
  employeeIds: string[],
  from: Date,
  to: Date,
  db: Db = prisma
): Promise<IAttendanceCount[]> => {
  try {
    if (employeeIds.length === 0) return [];
    const groups = await db.hrAttendance.groupBy({
      by: ["employeeId", "status"],
      where: { employeeId: { in: employeeIds }, date: { gte: from, lte: to } },
      _count: { _all: true },
    });
    const byEmployee = new Map<string, IAttendanceCount>();
    for (const g of groups) {
      const entry = byEmployee.get(g.employeeId) ?? { employeeId: g.employeeId, present: 0, late: 0 };
      if (g.status === "present") entry.present = g._count._all;
      if (g.status === "late") entry.late = g._count._all;
      byEmployee.set(g.employeeId, entry);
    }
    return [...byEmployee.values()];
  } catch (error) {
    throw error;
  }
};

const countRecorded = async (scope: string | null, date: Date, db: Db = prisma): Promise<number> => {
  try {
    return await db.hrAttendance.count({ where: { date, ...(scope ? { storeId: scope } : {}) } });
  } catch (error) {
    throw error;
  }
};

// Recorded days for a store (or all) on one date that are still open: people who are in.
const listStillIn = async (scope: string | null, date: Date, limit: number, db: Db = prisma): Promise<IAttendance[]> => {
  try {
    const rows = await db.hrAttendance.findMany({
      where: { date, clockOut: null, clockIn: { not: null }, ...(scope ? { storeId: scope } : {}) },
      orderBy: [{ clockIn: "asc" }, { id: "asc" }],
      take: limit,
    });
    return rows.map(toAttendance);
  } catch (error) {
    throw error;
  }
};

const createCorrection = async (data: IAttendanceCorrectionCreate, db: Db): Promise<IAttendanceCorrection> => {
  try {
    return await db.hrAttendanceCorrection.create({ data });
  } catch (error) {
    throw error;
  }
};

const listCorrections = async (
  filter: IAttendanceCorrectionFilter,
  db: Db = prisma
): Promise<{ items: IAttendanceCorrection[]; total: number }> => {
  try {
    const where: Prisma.HrAttendanceCorrectionWhereInput = {
      ...(filter.storeId ? { storeId: filter.storeId } : {}),
      ...(filter.employeeId ? { employeeId: filter.employeeId } : {}),
      ...(filter.from || filter.to ? { date: { gte: filter.from, lte: filter.to } } : {}),
    };
    const [items, total] = await Promise.all([
      db.hrAttendanceCorrection.findMany({
        where,
        orderBy: [{ date: "desc" }, { createdAt: "desc" }, { id: "asc" }],
        skip: filter.offset,
        take: filter.limit,
      }),
      db.hrAttendanceCorrection.count({ where }),
    ]);
    return { items, total };
  } catch (error) {
    throw error;
  }
};

export const AttendanceQuery = {
  findDay,
  findOpen,
  create,
  update,
  listForEmployees,
  countByEmployee,
  countRecorded,
  listStillIn,
  createCorrection,
  listCorrections,
};
