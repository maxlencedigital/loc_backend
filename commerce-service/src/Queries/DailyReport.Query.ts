import type { Prisma } from "@prisma/client";
import { prisma } from "../DB/Prisma.Connection.Db.js";
import {
  IBlockerTheme,
  IDailyReport,
  IDailyReportCreate,
  IDailyReportFilter,
  IReassignmentCreate,
} from "../Models/Hr/Career.Interface.js";
import type { Db } from "./Hr.Transaction.js";

const reportInclude = { employee: { select: { name: true } } } satisfies Prisma.HrDailyReportInclude;
type ReportRow = Prisma.HrDailyReportGetPayload<{ include: typeof reportInclude }>;

const toReport = ({ employee, createdAt, ...row }: ReportRow): IDailyReport => ({
  ...row,
  employeeName: employee.name,
  createdAt,
});

const create = async (data: IDailyReportCreate, db: Db = prisma): Promise<IDailyReport> => {
  try {
    return toReport(await db.hrDailyReport.create({ data, include: reportInclude }));
  } catch (error) {
    throw error;
  }
};

const findById = async (id: string, scope: string | null, db: Db = prisma): Promise<IDailyReport | null> => {
  try {
    const row = await db.hrDailyReport.findFirst({
      where: { id, ...(scope ? { employee: { storeId: scope } } : {}) },
      include: reportInclude,
    });
    return row ? toReport(row) : null;
  } catch (error) {
    throw error;
  }
};

// Scoped through the employee's current store, like every other HR read.
const list = async (
  filter: IDailyReportFilter,
  db: Db = prisma
): Promise<{ items: IDailyReport[]; total: number }> => {
  try {
    const where: Prisma.HrDailyReportWhereInput = {
      ...(filter.storeId ? { employee: { storeId: filter.storeId } } : {}),
      ...(filter.employeeId ? { employeeId: filter.employeeId } : {}),
      ...(filter.from || filter.to ? { date: { gte: filter.from, lte: filter.to } } : {}),
    };
    const [rows, total] = await Promise.all([
      db.hrDailyReport.findMany({
        where,
        include: reportInclude,
        orderBy: [{ date: "desc" }, { createdAt: "desc" }, { id: "asc" }],
        skip: filter.offset,
        take: filter.limit,
      }),
      db.hrDailyReport.count({ where }),
    ]);
    return { items: rows.map(toReport), total };
  } catch (error) {
    throw error;
  }
};

// The same blocker said by several reports in the window, most frequent first, in SQL.
const blockerThemes = async (
  scope: string | null,
  from: Date,
  to: Date,
  minCount: number,
  limit: number,
  db: Db = prisma
): Promise<IBlockerTheme[]> => {
  try {
    const groups = await db.hrDailyReport.groupBy({
      by: ["blockerKey"],
      where: {
        blockerKey: { not: null },
        date: { gte: from, lte: to },
        ...(scope ? { employee: { storeId: scope } } : {}),
      },
      _count: { _all: true },
      having: { blockerKey: { _count: { gte: minCount } } },
      orderBy: [{ _count: { blockerKey: "desc" } }, { blockerKey: "asc" }],
      take: limit,
    });
    return groups.map((g) => ({ key: g.blockerKey as string, count: g._count._all }));
  } catch (error) {
    throw error;
  }
};

/** The words people actually used for the given themes, newest first, capped. */
const blockerExamples = async (
  scope: string | null,
  keys: string[],
  from: Date,
  to: Date,
  cap: number,
  db: Db = prisma
): Promise<{ blockerKey: string; blockers: string }[]> => {
  try {
    if (keys.length === 0) return [];
    const rows = await db.hrDailyReport.findMany({
      where: {
        blockerKey: { in: keys },
        date: { gte: from, lte: to },
        ...(scope ? { employee: { storeId: scope } } : {}),
      },
      orderBy: [{ date: "desc" }, { id: "asc" }],
      take: cap,
      select: { blockerKey: true, blockers: true },
    });
    return rows.map((row) => ({ blockerKey: row.blockerKey as string, blockers: row.blockers as string }));
  } catch (error) {
    throw error;
  }
};

const createReassignment = async (data: IReassignmentCreate, db: Db = prisma): Promise<{ id: string }> => {
  try {
    return await db.hrWorkReassignment.create({ data, select: { id: true } });
  } catch (error) {
    throw error;
  }
};

export const DailyReportQuery = { create, findById, list, blockerThemes, blockerExamples, createReassignment };
