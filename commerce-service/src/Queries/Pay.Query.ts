import type { HrCompensation, HrIncentiveEarning, HrIncentiveScheme, HrPayout, Prisma } from "@prisma/client";
import { prisma } from "../DB/Prisma.Connection.Db.js";
import {
  IAssignedScheme,
  ICompensation,
  ICompensationCreate,
  IEarning,
  IEarningFilter,
  IEarningWrite,
  IIncentiveRule,
  IIncentiveScheme,
  IMetricValue,
  IPayout,
  IPayoutCreate,
  IPayoutFilter,
  ISchemeWrite,
  PayoutType,
} from "../Models/Hr/Pay.Interface.js";
import type { Db } from "./Hr.Transaction.js";

const MAX_VERSIONS = 100;
const MAX_MONTH_ROWS = 200;

const toCompensation = (row: HrCompensation): ICompensation => ({
  id: row.id,
  employeeId: row.employeeId,
  baseSalaryPaise: row.baseSalaryPaise,
  payCycle: row.payCycle,
  allowances: row.allowances as Record<string, number>,
  bonusEligible: row.bonusEligible,
  effectiveFrom: row.effectiveFrom,
  createdByName: row.createdByName,
  createdAt: row.createdAt,
});

const toScheme = (row: HrIncentiveScheme): IIncentiveScheme => ({
  id: row.id,
  name: row.name,
  appliesTo: row.appliesTo,
  metric: row.metric,
  period: row.period,
  rules: row.rules as unknown as IIncentiveRule[],
  isActive: row.isActive,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

const toEarning = (row: HrIncentiveEarning): IEarning => ({
  id: row.id,
  employeeId: row.employeeId,
  schemeId: row.schemeId,
  schemeName: row.schemeName,
  period: row.period,
  periodStart: row.periodStart,
  periodEnd: row.periodEnd,
  metricValueMilli: row.metricValueMilli,
  rewardPaise: row.rewardPaise,
  status: row.status,
  approvedAt: row.approvedAt,
  approvedByName: row.approvedByName,
  paidAt: row.paidAt,
  createdAt: row.createdAt,
});

const toPayout = (row: HrPayout): IPayout => ({ ...row });

// ------------------------------------------------------------ compensation

const createCompensation = async (data: ICompensationCreate, db: Db): Promise<ICompensation> => {
  try {
    return toCompensation(await db.hrCompensation.create({ data: { ...data, allowances: data.allowances } }));
  } catch (error) {
    throw error;
  }
};

/** Newest first, at most 100 versions. */
const listCompensation = async (employeeId: string, db: Db = prisma): Promise<ICompensation[]> => {
  try {
    const rows = await db.hrCompensation.findMany({ where: { employeeId }, orderBy: { effectiveFrom: "desc" }, take: MAX_VERSIONS });
    return rows.map(toCompensation);
  } catch (error) {
    throw error;
  }
};

const latestCompensation = async (employeeId: string, db: Db = prisma): Promise<ICompensation | null> => {
  try {
    const row = await db.hrCompensation.findFirst({ where: { employeeId }, orderBy: { effectiveFrom: "desc" } });
    return row ? toCompensation(row) : null;
  } catch (error) {
    throw error;
  }
};

// ----------------------------------------------------------------- schemes

const createScheme = async (data: ISchemeWrite, db: Db = prisma): Promise<IIncentiveScheme> => {
  try {
    return toScheme(await db.hrIncentiveScheme.create({ data: { ...data, rules: data.rules as unknown as Prisma.InputJsonValue } }));
  } catch (error) {
    throw error;
  }
};

const findScheme = async (id: string, db: Db = prisma): Promise<IIncentiveScheme | null> => {
  try {
    const row = await db.hrIncentiveScheme.findUnique({ where: { id } });
    return row ? toScheme(row) : null;
  } catch (error) {
    throw error;
  }
};

const listSchemes = async (offset: number, limit: number, db: Db = prisma): Promise<{ items: IIncentiveScheme[]; total: number }> => {
  try {
    const [rows, total] = await Promise.all([
      db.hrIncentiveScheme.findMany({ orderBy: [{ name: "asc" }, { id: "asc" }], skip: offset, take: limit }),
      db.hrIncentiveScheme.count(),
    ]);
    return { items: rows.map(toScheme), total };
  } catch (error) {
    throw error;
  }
};

const updateScheme = async (id: string, data: Partial<ISchemeWrite>, db: Db = prisma): Promise<IIncentiveScheme | null> => {
  try {
    const { rules, ...rest } = data;
    const { count } = await db.hrIncentiveScheme.updateMany({
      where: { id },
      data: { ...rest, ...(rules ? { rules: rules as unknown as Prisma.InputJsonValue } : {}) },
    });
    return count === 0 ? null : await findScheme(id, db);
  } catch (error) {
    throw error;
  }
};

const assignMany = async (schemeId: string, employeeIds: string[], by: string, db: Db): Promise<void> => {
  try {
    await db.hrIncentiveAssignment.createMany({
      data: employeeIds.map((employeeId) => ({ schemeId, employeeId, assignedByName: by })),
      skipDuplicates: true,
    });
  } catch (error) {
    throw error;
  }
};

const assignedEmployeeIds = async (schemeId: string, employeeIds: string[], db: Db = prisma): Promise<string[]> => {
  try {
    const rows = await db.hrIncentiveAssignment.findMany({ where: { schemeId, employeeId: { in: employeeIds } }, select: { employeeId: true } });
    return rows.map((r) => r.employeeId);
  } catch (error) {
    throw error;
  }
};

/** Active schemes assigned to these people, in one query. */
const activeSchemesFor = async (employeeIds: string[], db: Db = prisma): Promise<IAssignedScheme[]> => {
  try {
    if (employeeIds.length === 0) return [];
    const rows = await db.hrIncentiveAssignment.findMany({
      where: { employeeId: { in: employeeIds }, scheme: { isActive: true } },
      include: { scheme: true },
    });
    return rows.map((r) => ({ employeeId: r.employeeId, scheme: toScheme(r.scheme) }));
  } catch (error) {
    throw error;
  }
};

// ----------------------------------------------------------------- metrics

const upsertMetric = async (m: IMetricValue, db: Db): Promise<void> => {
  try {
    await db.hrIncentiveMetricValue.upsert({
      where: { employeeId_metric_period: { employeeId: m.employeeId, metric: m.metric, period: m.period } },
      create: m,
      update: { valueMilli: m.valueMilli },
    });
  } catch (error) {
    throw error;
  }
};

// ---------------------------------------------------------------- earnings

// A pending earning follows its metric; an approved or paid one is final, so the insert
// below is skipped for it (its unique key exists) and nothing is overwritten.
const upsertPendingEarning = async (e: IEarningWrite, createIfMissing: boolean, db: Db): Promise<void> => {
  try {
    const { count } = await db.hrIncentiveEarning.updateMany({
      where: { employeeId: e.employeeId, schemeId: e.schemeId, period: e.period, status: "pending" },
      data: { metricValueMilli: e.metricValueMilli, rewardPaise: e.rewardPaise, schemeName: e.schemeName },
    });
    if (count === 0 && createIfMissing) await db.hrIncentiveEarning.createMany({ data: [e], skipDuplicates: true });
  } catch (error) {
    throw error;
  }
};

const earningWhere = (f: IEarningFilter): Prisma.HrIncentiveEarningWhereInput => ({
  ...(f.employeeId ? { employeeId: f.employeeId } : f.employeeIds ? { employeeId: { in: f.employeeIds } } : {}),
  ...(f.status ? { status: f.status } : {}),
  ...(f.periodMonth ? { periodStart: { gte: f.periodMonth.from, lte: f.periodMonth.to } } : {}),
  ...(f.periodExact ? { period: f.periodExact } : {}),
});

const listEarnings = async (filter: IEarningFilter, db: Db = prisma): Promise<{ items: IEarning[]; total: number }> => {
  try {
    const where = earningWhere(filter);
    const [rows, total] = await Promise.all([
      db.hrIncentiveEarning.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "asc" }], skip: filter.offset, take: filter.limit }),
      db.hrIncentiveEarning.count({ where }),
    ]);
    return { items: rows.map(toEarning), total };
  } catch (error) {
    throw error;
  }
};

const findEarning = async (id: string, db: Db = prisma): Promise<IEarning | null> => {
  try {
    const row = await db.hrIncentiveEarning.findUnique({ where: { id } });
    return row ? toEarning(row) : null;
  } catch (error) {
    throw error;
  }
};

/** pending to approved, once: of two simultaneous approvals one writes. */
const approveEarning = async (id: string, at: Date, by: string, db: Db): Promise<boolean> => {
  try {
    const { count } = await db.hrIncentiveEarning.updateMany({
      where: { id, status: "pending" },
      data: { status: "approved", approvedAt: at, approvedByName: by },
    });
    return count > 0;
  } catch (error) {
    throw error;
  }
};

/** One person's earnings of a month, oldest period first (bounded). */
const earningsOfMonth = async (employeeId: string, from: Date, to: Date, db: Db = prisma): Promise<IEarning[]> => {
  try {
    const rows = await db.hrIncentiveEarning.findMany({
      where: { employeeId, periodStart: { gte: from, lte: to } },
      orderBy: [{ periodStart: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      take: MAX_MONTH_ROWS,
    });
    return rows.map(toEarning);
  } catch (error) {
    throw error;
  }
};

const markPaid = async (ids: string[], at: Date, db: Db): Promise<void> => {
  try {
    if (ids.length > 0) await db.hrIncentiveEarning.updateMany({ where: { id: { in: ids }, status: "approved" }, data: { status: "paid", paidAt: at } });
  } catch (error) {
    throw error;
  }
};

// ----------------------------------------------------------------- payouts

const createPayout = async (data: IPayoutCreate, db: Db): Promise<IPayout> => {
  try {
    return toPayout(await db.hrPayout.create({ data }));
  } catch (error) {
    throw error;
  }
};

const findPayoutByKey = async (userId: string, key: string, db: Db = prisma): Promise<IPayout | null> => {
  try {
    const row = await db.hrPayout.findUnique({ where: { recordedByUserId_idempotencyKey: { recordedByUserId: userId, idempotencyKey: key } } });
    return row ? toPayout(row) : null;
  } catch (error) {
    throw error;
  }
};

const listPayouts = async (f: IPayoutFilter, db: Db = prisma): Promise<{ items: IPayout[]; total: number }> => {
  try {
    const where: Prisma.HrPayoutWhereInput = {
      ...(f.employeeId ? { employeeId: f.employeeId } : f.employeeIds ? { employeeId: { in: f.employeeIds } } : {}),
      ...(f.type ? { type: f.type } : {}),
      ...(f.from || f.to ? { paidOn: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lte: f.to } : {}) } } : {}),
    };
    const [rows, total] = await Promise.all([
      db.hrPayout.findMany({ where, orderBy: [{ paidOn: "desc" }, { createdAt: "desc" }, { id: "asc" }], skip: f.offset, take: f.limit }),
      db.hrPayout.count({ where }),
    ]);
    return { items: rows.map(toPayout), total };
  } catch (error) {
    throw error;
  }
};

/** Paise paid to a person for a month, per payout type: one grouped query. */
const sumsByType = async (employeeId: string, period: string, db: Db = prisma): Promise<Partial<Record<PayoutType, number>>> => {
  try {
    const groups = await db.hrPayout.groupBy({ by: ["type"], where: { employeeId, period }, _sum: { amountPaise: true } });
    return Object.fromEntries(groups.map((g) => [g.type, g._sum.amountPaise ?? 0]));
  } catch (error) {
    throw error;
  }
};

export const PayQuery = {
  createCompensation,
  listCompensation,
  latestCompensation,
  createScheme,
  findScheme,
  listSchemes,
  updateScheme,
  assignMany,
  assignedEmployeeIds,
  activeSchemesFor,
  upsertMetric,
  upsertPendingEarning,
  listEarnings,
  findEarning,
  approveEarning,
  earningsOfMonth,
  markPaid,
  createPayout,
  findPayoutByKey,
  listPayouts,
  sumsByType,
};
