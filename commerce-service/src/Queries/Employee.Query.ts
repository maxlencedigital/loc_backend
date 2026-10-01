import type { Prisma } from "@prisma/client";
import { prisma } from "../DB/Prisma.Connection.Db.js";
import {
  EmployeeStatus,
  EmployeeType,
  IEmployee,
  IEmployeeCreate,
  IEmployeeFilter,
  IEmployeeUpdate,
  IHeadcount,
  IHistoryEntry,
  IHistoryEntryCreate,
} from "../Models/Hr/Employee.Interface.js";
import type { Db } from "./Hr.Transaction.js";

const EMPLOYEE_CODE_COUNTER = "employee_code";
export const UNASSIGNED_STORE = "unassigned";

// A scope narrows to one store; null means every store. A store-bound caller never
// matches an employee with no store, so riders without one are invisible to them.
const scoped = (scope: string | null): Prisma.HrEmployeeWhereInput => (scope ? { storeId: scope } : {});

const nextCodeNumber = async (db: Db): Promise<number> => {
  try {
    // One atomic UPDATE ... RETURNING: concurrent creations queue for a number.
    const counter = await db.sequenceCounter.update({
      where: { name: EMPLOYEE_CODE_COUNTER },
      data: { value: { increment: 1 } },
    });
    return counter.value;
  } catch (error) {
    throw error;
  }
};

const create = async (data: IEmployeeCreate, code: string, db: Db): Promise<IEmployee> => {
  try {
    return await db.hrEmployee.create({ data: { ...data, code } });
  } catch (error) {
    throw error;
  }
};

const findById = async (id: string, scope: string | null, db: Db = prisma): Promise<IEmployee | null> => {
  try {
    return await db.hrEmployee.findFirst({ where: { id, ...scoped(scope) } });
  } catch (error) {
    throw error;
  }
};

// A no-op UPDATE takes the row lock until the transaction ends: two changes to one
// employee (or to anything that must be serialised per employee) queue behind it.
const lockById = async (id: string, scope: string | null, db: Db): Promise<IEmployee | null> => {
  try {
    const { count } = await db.hrEmployee.updateMany({ where: { id, ...scoped(scope) }, data: { updatedAt: new Date() } });
    return count === 0 ? null : await findById(id, scope, db);
  } catch (error) {
    throw error;
  }
};

const findByGatewayUserId = async (gatewayUserId: string, db: Db = prisma): Promise<IEmployee | null> => {
  try {
    return await db.hrEmployee.findUnique({ where: { gatewayUserId } });
  } catch (error) {
    throw error;
  }
};

const findByIds = async (ids: string[], scope: string | null, db: Db = prisma): Promise<IEmployee[]> => {
  try {
    return ids.length === 0 ? [] : await db.hrEmployee.findMany({ where: { id: { in: ids }, ...scoped(scope) } });
  } catch (error) {
    throw error;
  }
};

const search = async (filter: IEmployeeFilter, db: Db = prisma): Promise<{ items: IEmployee[]; total: number }> => {
  try {
    const q = filter.q?.trim();
    const qDigits = q?.replace(/\D/g, "");
    const where: Prisma.HrEmployeeWhereInput = {
      ...scoped(filter.storeId),
      ...(filter.employeeType ? { employeeType: filter.employeeType } : {}),
      ...(filter.status ? { status: filter.status } : {}),
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: "insensitive" } },
              { code: { contains: q, mode: "insensitive" } },
              ...(qDigits ? [{ phone: { contains: qDigits } }] : []),
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      db.hrEmployee.findMany({ where, orderBy: [{ name: "asc" }, { id: "asc" }], skip: filter.offset, take: filter.limit }),
      db.hrEmployee.count({ where }),
    ]);
    return { items, total };
  } catch (error) {
    throw error;
  }
};

// Employees on the books at any point of [from, to]: joined by then and not gone before.
const inPeriodWhere = (scope: string | null, from: Date, to: Date): Prisma.HrEmployeeWhereInput => ({
  ...scoped(scope),
  joinDate: { lte: to },
  OR: [{ status: { not: "exited" } }, { lastWorkingDay: { gte: from } }],
});

const listInPeriod = async (
  scope: string | null,
  from: Date,
  to: Date,
  offset: number,
  limit: number,
  db: Db = prisma
): Promise<{ items: IEmployee[]; total: number }> => {
  try {
    const where = inPeriodWhere(scope, from, to);
    const [items, total] = await Promise.all([
      db.hrEmployee.findMany({ where, orderBy: [{ name: "asc" }, { id: "asc" }], skip: offset, take: limit }),
      db.hrEmployee.count({ where }),
    ]);
    return { items, total };
  } catch (error) {
    throw error;
  }
};

const update = async (id: string, data: IEmployeeUpdate, db: Db): Promise<IEmployee> => {
  try {
    return await db.hrEmployee.update({ where: { id }, data });
  } catch (error) {
    throw error;
  }
};

const listIds = async (
  scope: string | null,
  options: { statuses?: EmployeeStatus[]; types?: EmployeeType[]; offset: number; limit: number },
  db: Db = prisma
): Promise<string[]> => {
  try {
    const rows = await db.hrEmployee.findMany({
      where: {
        ...scoped(scope),
        ...(options.statuses ? { status: { in: options.statuses } } : {}),
        ...(options.types ? { employeeType: { in: options.types } } : {}),
      },
      select: { id: true },
      orderBy: { id: "asc" },
      skip: options.offset,
      take: options.limit,
    });
    return rows.map((row) => row.id);
  } catch (error) {
    throw error;
  }
};

// Headcount excludes people who have left; byStatus keeps every status so exits show too.
const headcount = async (scope: string | null, db: Db = prisma): Promise<IHeadcount> => {
  try {
    const where = { ...scoped(scope), status: { not: "exited" as const } };
    const [byType, byStatus, byStore] = await Promise.all([
      db.hrEmployee.groupBy({ by: ["employeeType"], where, _count: { _all: true } }),
      db.hrEmployee.groupBy({ by: ["status"], where: scoped(scope), _count: { _all: true } }),
      db.hrEmployee.groupBy({ by: ["storeId"], where, _count: { _all: true } }),
    ]);
    return {
      byType: Object.fromEntries(byType.map((g) => [g.employeeType, g._count._all])),
      byStatus: Object.fromEntries(byStatus.map((g) => [g.status, g._count._all])),
      byStore: Object.fromEntries(byStore.map((g) => [g.storeId ?? UNASSIGNED_STORE, g._count._all])),
    };
  } catch (error) {
    throw error;
  }
};

const countExitsSince = async (scope: string | null, since: Date, db: Db = prisma): Promise<number> => {
  try {
    return await db.hrEmployee.count({ where: { ...scoped(scope), status: "exited", lastWorkingDay: { gte: since } } });
  } catch (error) {
    throw error;
  }
};

// People expected at work on `date`, per store (null key = no store).
const countExpectedByStore = async (
  scope: string | null,
  date: Date,
  db: Db = prisma
): Promise<Record<string, number>> => {
  try {
    const groups = await db.hrEmployee.groupBy({
      by: ["storeId"],
      where: inPeriodWhere(scope, date, date),
      _count: { _all: true },
    });
    return Object.fromEntries(groups.map((g) => [g.storeId ?? UNASSIGNED_STORE, g._count._all]));
  } catch (error) {
    throw error;
  }
};

const appendHistory = async (entries: IHistoryEntryCreate[], db: Db): Promise<void> => {
  try {
    if (entries.length > 0) await db.hrEmployeeHistory.createMany({ data: entries });
  } catch (error) {
    throw error;
  }
};

const listHistory = async (
  employeeId: string,
  offset: number,
  limit: number,
  db: Db = prisma
): Promise<{ items: IHistoryEntry[]; total: number }> => {
  try {
    const where = { employeeId };
    const [items, total] = await Promise.all([
      db.hrEmployeeHistory.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        skip: offset,
        take: limit,
      }),
      db.hrEmployeeHistory.count({ where }),
    ]);
    return { items, total };
  } catch (error) {
    throw error;
  }
};

export const EmployeeQuery = {
  nextCodeNumber,
  create,
  findById,
  lockById,
  findByGatewayUserId,
  findByIds,
  search,
  listInPeriod,
  update,
  listIds,
  headcount,
  countExitsSince,
  countExpectedByStore,
  appendHistory,
  listHistory,
};
