import type { HrAppraisal, Prisma } from "@prisma/client";
import { prisma } from "../DB/Prisma.Connection.Db.js";
import {
  AppraisalOutcome,
  AppraisalStatus,
  IAppraisal,
  IAppraisalCreate,
  IAppraisalFilter,
  IConduct,
  IRatingRow,
} from "../Models/Hr/Performance.Interface.js";
import type { Db } from "./Hr.Transaction.js";

const MAX_RATING_ROWS = 5000;

const toAppraisal = (row: HrAppraisal): IAppraisal => ({
  id: row.id,
  employeeId: row.employeeId,
  cycle: row.cycle,
  scheduledFor: row.scheduledFor,
  reviewerId: row.reviewerId,
  status: row.status,
  rating: row.rating,
  strengths: row.strengths,
  improvements: row.improvements,
  goals: row.goals,
  conductedAt: row.conductedAt,
  conductedByName: row.conductedByName,
  outcome: row.outcome,
  outcomeNote: row.outcomeNote,
  completedAt: row.completedAt,
  completedByName: row.completedByName,
  createdByName: row.createdByName,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

const create = async (data: IAppraisalCreate, db: Db = prisma): Promise<IAppraisal> => {
  try {
    return toAppraisal(await db.hrAppraisal.create({ data }));
  } catch (error) {
    throw error;
  }
};

// ON CONFLICT DO NOTHING on (employee, cycle): a person has one appraisal per cycle even
// when two schedule requests race.
const createMany = async (rows: IAppraisalCreate[], db: Db = prisma): Promise<number> => {
  try {
    if (rows.length === 0) return 0;
    const { count } = await db.hrAppraisal.createMany({ data: rows, skipDuplicates: true });
    return count;
  } catch (error) {
    throw error;
  }
};

const findById = async (id: string, db: Db = prisma): Promise<IAppraisal | null> => {
  try {
    const row = await db.hrAppraisal.findUnique({ where: { id } });
    return row ? toAppraisal(row) : null;
  } catch (error) {
    throw error;
  }
};

const findByCycle = async (cycle: string, employeeIds: string[], db: Db = prisma): Promise<IAppraisal[]> => {
  try {
    if (employeeIds.length === 0) return [];
    const rows = await db.hrAppraisal.findMany({ where: { cycle, employeeId: { in: employeeIds } }, orderBy: { id: "asc" } });
    return rows.map(toAppraisal);
  } catch (error) {
    throw error;
  }
};

const list = async (filter: IAppraisalFilter, db: Db = prisma): Promise<{ items: IAppraisal[]; total: number }> => {
  try {
    const where: Prisma.HrAppraisalWhereInput = {
      ...(filter.employeeId ? { employeeId: filter.employeeId } : filter.employeeIds ? { employeeId: { in: filter.employeeIds } } : {}),
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.cycle ? { cycle: filter.cycle } : {}),
    };
    const [rows, total] = await Promise.all([
      db.hrAppraisal.findMany({ where, orderBy: [{ scheduledFor: "desc" }, { id: "asc" }], skip: filter.offset, take: filter.limit }),
      db.hrAppraisal.count({ where }),
    ]);
    return { items: rows.map(toAppraisal), total };
  } catch (error) {
    throw error;
  }
};

const listForEmployee = async (employeeId: string, limit: number, db: Db = prisma): Promise<IAppraisal[]> => {
  try {
    const rows = await db.hrAppraisal.findMany({ where: { employeeId }, orderBy: [{ scheduledFor: "desc" }, { id: "asc" }], take: limit });
    return rows.map(toAppraisal);
  } catch (error) {
    throw error;
  }
};

/** Edit the schedule of an appraisal that has not started. False when it already moved on. */
const reschedule = async (
  id: string,
  data: { cycle?: string; scheduledFor?: Date; reviewerId?: string | null },
  db: Db
): Promise<boolean> => {
  try {
    const { count } = await db.hrAppraisal.updateMany({ where: { id, status: "scheduled" }, data });
    return count > 0;
  } catch (error) {
    throw error;
  }
};

const start = async (id: string, db: Db): Promise<boolean> => {
  try {
    const { count } = await db.hrAppraisal.updateMany({ where: { id, status: "scheduled" }, data: { status: "in_progress" } });
    return count > 0;
  } catch (error) {
    throw error;
  }
};

// The rating is written once: the condition "no rating yet" makes a second submission a no-op.
const conduct = async (id: string, data: IConduct, db: Db): Promise<boolean> => {
  try {
    const { count } = await db.hrAppraisal.updateMany({
      where: { id, status: { in: ["scheduled", "in_progress"] as AppraisalStatus[] }, rating: null },
      data: { ...data, status: "in_progress" },
    });
    return count > 0;
  } catch (error) {
    throw error;
  }
};

const complete = async (
  id: string,
  data: { outcome: AppraisalOutcome; outcomeNote: string | null; completedAt: Date; completedByName: string },
  db: Db
): Promise<boolean> => {
  try {
    const { count } = await db.hrAppraisal.updateMany({
      where: { id, status: "in_progress", rating: { not: null } },
      data: { ...data, status: "completed" },
    });
    return count > 0;
  } catch (error) {
    throw error;
  }
};

/** Ratings given in [from, to] to these employees, newest first. Bounded. */
const ratingsFor = async (employeeIds: string[], from: Date, to: Date, db: Db = prisma): Promise<IRatingRow[]> => {
  try {
    if (employeeIds.length === 0) return [];
    const rows = await db.hrAppraisal.findMany({
      where: { employeeId: { in: employeeIds }, rating: { not: null }, conductedAt: { gte: from, lt: to } },
      select: { employeeId: true, rating: true, conductedAt: true },
      orderBy: { conductedAt: "desc" },
      take: MAX_RATING_ROWS,
    });
    return rows.map((row) => ({ employeeId: row.employeeId, rating: row.rating as number, conductedAt: row.conductedAt as Date }));
  } catch (error) {
    throw error;
  }
};

/** How many rated appraisals gave each rating: a SQL aggregate, never the rows. */
const ratingDistribution = async (
  employeeIds: string[] | null,
  from: Date,
  to: Date,
  db: Db = prisma
): Promise<Record<number, number>> => {
  try {
    const groups = await db.hrAppraisal.groupBy({
      by: ["rating"],
      where: {
        ...(employeeIds ? { employeeId: { in: employeeIds } } : {}),
        rating: { not: null },
        conductedAt: { gte: from, lt: to },
      },
      _count: { _all: true },
    });
    return Object.fromEntries(groups.map((g) => [g.rating as number, g._count._all]));
  } catch (error) {
    throw error;
  }
};

export const PerformanceQuery = {
  create,
  createMany,
  findById,
  findByCycle,
  list,
  listForEmployee,
  reschedule,
  start,
  conduct,
  complete,
  ratingsFor,
  ratingDistribution,
};
