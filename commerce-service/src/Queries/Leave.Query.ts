import type { Prisma } from "@prisma/client";
import { prisma } from "../DB/Prisma.Connection.Db.js";
import {
  ILeaveBalance,
  ILeaveDecision,
  ILeaveLedgerCreate,
  ILeavePolicy,
  ILeaveRequest,
  ILeaveRequestCreate,
  ILeaveRequestFilter,
  LeaveStatus,
  LeaveType,
} from "../Models/Hr/Leave.Interface.js";
import type { Db } from "./Hr.Transaction.js";

const requestInclude = { employee: { select: { name: true, storeId: true } } } satisfies Prisma.HrLeaveRequestInclude;
type RequestRow = Prisma.HrLeaveRequestGetPayload<{ include: typeof requestInclude }>;

const toRequest = (row: RequestRow): ILeaveRequest => ({
  id: row.id,
  employeeId: row.employeeId,
  employeeName: row.employee.name,
  employeeStoreId: row.employee.storeId,
  type: row.type,
  fromDate: row.fromDate,
  toDate: row.toDate,
  halfDay: row.halfDay,
  chargeableHalfDays: row.chargeableHalfDays,
  status: row.status,
  reason: row.reason,
  decidedByUserId: row.decidedByUserId,
  decidedByName: row.decidedByName,
  decidedAt: row.decidedAt,
  decisionNote: row.decisionNote,
  createdAt: row.createdAt,
});

// A store-bound caller reaches a request through the employee's current store.
const employeeScope = (scope: string | null): Prisma.HrLeaveRequestWhereInput =>
  scope ? { employee: { storeId: scope } } : {};

// ---------------------------------------------------------------- policies
const listPolicies = async (db: Db = prisma): Promise<ILeavePolicy[]> => {
  try {
    return await db.hrLeavePolicy.findMany({
      orderBy: { type: "asc" },
      select: { type: true, annualHalfDays: true, carryForward: true },
    });
  } catch (error) {
    throw error;
  }
};

const upsertPolicies = async (policies: ILeavePolicy[], db: Db): Promise<void> => {
  try {
    for (const policy of policies) {
      await db.hrLeavePolicy.upsert({
        where: { type: policy.type },
        create: policy,
        update: { annualHalfDays: policy.annualHalfDays, carryForward: policy.carryForward },
      });
    }
  } catch (error) {
    throw error;
  }
};

// --------------------------------------------------------------- balances
const createBalanceIfMissing = async (
  employeeId: string,
  type: LeaveType,
  year: number,
  entitledHalfDays: number,
  db: Db
): Promise<boolean> => {
  try {
    const { count } = await db.hrLeaveBalance.createMany({
      data: [{ employeeId, type, year, entitledHalfDays }],
      skipDuplicates: true,
    });
    return count > 0;
  } catch (error) {
    throw error;
  }
};

const findBalance = async (
  employeeId: string,
  type: LeaveType,
  year: number,
  db: Db = prisma
): Promise<ILeaveBalance | null> => {
  try {
    return await db.hrLeaveBalance.findUnique({
      where: { employeeId_type_year: { employeeId, type, year } },
      select: { id: true, employeeId: true, type: true, year: true, entitledHalfDays: true, takenHalfDays: true },
    });
  } catch (error) {
    throw error;
  }
};

// The no-op UPDATE is the row lock; the read after it sees whatever the previous holder committed.
const lockBalance = async (
  employeeId: string,
  type: LeaveType,
  year: number,
  db: Db
): Promise<ILeaveBalance | null> => {
  try {
    await db.hrLeaveBalance.updateMany({ where: { employeeId, type, year }, data: { updatedAt: new Date() } });
    return await findBalance(employeeId, type, year, db);
  } catch (error) {
    throw error;
  }
};

const addTaken = async (id: string, halfDays: number, db: Db): Promise<void> => {
  try {
    await db.hrLeaveBalance.update({ where: { id }, data: { takenHalfDays: { increment: halfDays } } });
  } catch (error) {
    throw error;
  }
};

const listBalances = async (employeeIds: string[], year: number, db: Db = prisma): Promise<ILeaveBalance[]> => {
  try {
    if (employeeIds.length === 0) return [];
    return await db.hrLeaveBalance.findMany({
      where: { employeeId: { in: employeeIds }, year },
      select: { id: true, employeeId: true, type: true, year: true, entitledHalfDays: true, takenHalfDays: true },
    });
  } catch (error) {
    throw error;
  }
};

const appendLedger = async (entry: ILeaveLedgerCreate, db: Db): Promise<void> => {
  try {
    await db.hrLeaveLedger.create({ data: entry });
  } catch (error) {
    throw error;
  }
};

// ---------------------------------------------------------------- requests
const createRequest = async (data: ILeaveRequestCreate, db: Db): Promise<ILeaveRequest> => {
  try {
    return toRequest(await db.hrLeaveRequest.create({ data, include: requestInclude }));
  } catch (error) {
    throw error;
  }
};

const findRequest = async (id: string, scope: string | null, db: Db = prisma): Promise<ILeaveRequest | null> => {
  try {
    const row = await db.hrLeaveRequest.findFirst({ where: { id, ...employeeScope(scope) }, include: requestInclude });
    return row ? toRequest(row) : null;
  } catch (error) {
    throw error;
  }
};

// Locks the request row until the transaction ends, so two decisions on it queue up.
const lockRequest = async (id: string, scope: string | null, db: Db): Promise<ILeaveRequest | null> => {
  try {
    const { count } = await db.hrLeaveRequest.updateMany({
      where: { id, ...employeeScope(scope) },
      data: { updatedAt: new Date() },
    });
    return count === 0 ? null : await findRequest(id, scope, db);
  } catch (error) {
    throw error;
  }
};

const decideRequest = async (id: string, decision: ILeaveDecision, db: Db): Promise<ILeaveRequest> => {
  try {
    return toRequest(await db.hrLeaveRequest.update({ where: { id }, data: decision, include: requestInclude }));
  } catch (error) {
    throw error;
  }
};

const withdrawRequest = async (id: string, db: Db): Promise<ILeaveRequest> => {
  try {
    return toRequest(await db.hrLeaveRequest.update({ where: { id }, data: { status: "withdrawn" }, include: requestInclude }));
  } catch (error) {
    throw error;
  }
};

// Requests that still hold the days: waiting or granted.
const countOverlapping = async (
  employeeId: string,
  from: Date,
  to: Date,
  db: Db = prisma
): Promise<number> => {
  try {
    return await db.hrLeaveRequest.count({
      where: { employeeId, status: { in: ["pending", "approved"] }, fromDate: { lte: to }, toDate: { gte: from } },
    });
  } catch (error) {
    throw error;
  }
};

const listRequests = async (
  filter: ILeaveRequestFilter,
  db: Db = prisma
): Promise<{ items: ILeaveRequest[]; total: number }> => {
  try {
    const where: Prisma.HrLeaveRequestWhereInput = {
      ...employeeScope(filter.storeId),
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.employeeId ? { employeeId: filter.employeeId } : {}),
      // A date window keeps requests that overlap it, not only those that start inside it.
      ...(filter.from ? { toDate: { gte: filter.from } } : {}),
      ...(filter.to ? { fromDate: { lte: filter.to } } : {}),
    };
    const [rows, total] = await Promise.all([
      db.hrLeaveRequest.findMany({
        where,
        include: requestInclude,
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        skip: filter.offset,
        take: filter.limit,
      }),
      db.hrLeaveRequest.count({ where }),
    ]);
    return { items: rows.map(toRequest), total };
  } catch (error) {
    throw error;
  }
};

const countByStatus = async (scope: string | null, status: LeaveStatus, db: Db = prisma): Promise<number> => {
  try {
    return await db.hrLeaveRequest.count({ where: { status, ...employeeScope(scope) } });
  } catch (error) {
    throw error;
  }
};

// Approved leave touching [from, to] for a store (or all), soonest first, for the calendar.
const listApprovedInRange = async (
  scope: string | null,
  from: Date,
  to: Date,
  offset: number,
  limit: number,
  db: Db = prisma
): Promise<{ items: ILeaveRequest[]; total: number }> => {
  try {
    const where: Prisma.HrLeaveRequestWhereInput = {
      ...employeeScope(scope),
      status: "approved",
      fromDate: { lte: to },
      toDate: { gte: from },
    };
    const [rows, total] = await Promise.all([
      db.hrLeaveRequest.findMany({
        where,
        include: requestInclude,
        orderBy: [{ fromDate: "asc" }, { id: "asc" }],
        skip: offset,
        take: limit,
      }),
      db.hrLeaveRequest.count({ where }),
    ]);
    return { items: rows.map(toRequest), total };
  } catch (error) {
    throw error;
  }
};

/** Approved leave of the given employees touching [from, to]. Bounded by the caller's page of ids. */
const approvedForEmployees = async (
  employeeIds: string[],
  from: Date,
  to: Date,
  db: Db = prisma
): Promise<{ employeeId: string; fromDate: Date; toDate: Date; halfDay: boolean }[]> => {
  try {
    if (employeeIds.length === 0) return [];
    return await db.hrLeaveRequest.findMany({
      where: { employeeId: { in: employeeIds }, status: "approved", fromDate: { lte: to }, toDate: { gte: from } },
      select: { employeeId: true, fromDate: true, toDate: true, halfDay: true },
    });
  } catch (error) {
    throw error;
  }
};

/** Distinct employees on approved leave on `date`. */
const countOnLeave = async (scope: string | null, date: Date, db: Db = prisma): Promise<number> => {
  try {
    const rows = await db.hrLeaveRequest.groupBy({
      by: ["employeeId"],
      where: { ...employeeScope(scope), status: "approved", fromDate: { lte: date }, toDate: { gte: date } },
    });
    return rows.length;
  } catch (error) {
    throw error;
  }
};

export const LeaveQuery = {
  listPolicies,
  upsertPolicies,
  createBalanceIfMissing,
  findBalance,
  lockBalance,
  addTaken,
  listBalances,
  appendLedger,
  createRequest,
  findRequest,
  lockRequest,
  decideRequest,
  withdrawRequest,
  countOverlapping,
  listRequests,
  countByStatus,
  listApprovedInRange,
  approvedForEmployees,
  countOnLeave,
};
