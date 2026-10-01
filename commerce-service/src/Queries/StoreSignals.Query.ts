import { Prisma } from "@prisma/client";
import { prisma } from "../DB/Prisma.Connection.Db.js";
import { IStaffHandled, IStaffMember, IStoreMetrics } from "../Models/StoreAdmin/StoreAdmin.Interface.js";
import { toDbDate } from "../Utils/StoreAdminInput.js";
import { qualified } from "./RawSql.js";

export type Db = Prisma.TransactionClient;

// Everything the store dashboards read about a store's performance. Order figures are SQL
// aggregates over a bounded date range. The complaint, staff, machine and equipment reads are
// read-only looks at tables other modules own (support, HR, floor, equipment); they are kept in
// this one file so a change in those modules touches one place.

const PROCESSED_STATUSES = ["packed", "out_for_delivery", "delivered"] as const;
const OPEN_COMPLAINT_STATUSES = ["open", "assigned", "in_progress", "escalated"] as const;
const MAX_LIST = 200;

// Orders and booked value per store; cancelled orders are not counted.
const orderTotals = async (storeIds: string[], start: Date, end: Date, db: Db = prisma) => {
  try {
    const groups = await db.order.groupBy({
      by: ["storeId"],
      where: { storeId: { in: storeIds }, placedAt: { gte: start, lt: end }, status: { not: "cancelled" } },
      _count: { _all: true },
      _sum: { amountPaise: true },
    });
    return new Map(groups.map((g) => [g.storeId, { orders: g._count._all, revenuePaise: g._sum.amountPaise ?? 0 }]));
  } catch (error) {
    throw error;
  }
};

// Of the delivered orders placed in the range, how many were delivered by their promised time.
const onTimeTotals = async (storeIds: string[], start: Date, end: Date, db: Db = prisma) => {
  try {
    const rows = await db.$queryRaw<{ storeId: string; delivered: number; onTime: number }[]>`
      SELECT o."storeId", count(*)::int AS "delivered",
             count(*) FILTER (WHERE e."at" <= o."promisedAt")::int AS "onTime"
      FROM ${qualified("commerce_orders")} o
      JOIN ${qualified("commerce_order_events")} e ON e."orderId" = o."id" AND e."status" = 'delivered'
      WHERE o."storeId" = ANY(${storeIds}::uuid[]) AND o."status" = 'delivered'
        AND o."placedAt" >= ${start} AND o."placedAt" < ${end}
      GROUP BY o."storeId"`;
    return new Map(rows.map((r) => [r.storeId, { delivered: r.delivered, onTime: r.onTime }]));
  } catch (error) {
    throw error;
  }
};

const metricsFor = async (storeIds: string[], start: Date, end: Date, db: Db = prisma): Promise<IStoreMetrics[]> => {
  try {
    const [totals, onTime] = await Promise.all([orderTotals(storeIds, start, end, db), onTimeTotals(storeIds, start, end, db)]);
    return storeIds.map((storeId) => ({
      storeId,
      orders: totals.get(storeId)?.orders ?? 0,
      revenuePaise: totals.get(storeId)?.revenuePaise ?? 0,
      delivered: onTime.get(storeId)?.delivered ?? 0,
      onTime: onTime.get(storeId)?.onTime ?? 0,
    }));
  } catch (error) {
    throw error;
  }
};

const countProcessed = async (storeId: string, start: Date, end: Date, db: Db = prisma): Promise<number> => {
  try {
    return await db.order.count({
      where: { storeId, placedAt: { gte: start, lt: end }, status: { in: [...PROCESSED_STATUSES] } },
    });
  } catch (error) {
    throw error;
  }
};

// An order was reworked when some event put it back to an earlier stage than one it had already
// reached (the status enum is declared in plant order, so `>` means "later stage").
const countReworked = async (storeId: string, start: Date, end: Date, db: Db = prisma): Promise<number> => {
  try {
    const rows = await db.$queryRaw<{ n: number }[]>`
      SELECT count(DISTINCT e."orderId")::int AS "n"
      FROM ${qualified("commerce_order_events")} e
      JOIN ${qualified("commerce_orders")} o ON o."id" = e."orderId"
      WHERE o."storeId" = ${storeId}::uuid AND o."placedAt" >= ${start} AND o."placedAt" < ${end}
        AND EXISTS (
          SELECT 1 FROM ${qualified("commerce_order_events")} p
          WHERE p."orderId" = e."orderId" AND p."at" < e."at" AND p."status" > e."status")`;
    return rows[0]?.n ?? 0;
  } catch (error) {
    throw error;
  }
};

// Orders each login touched (any status change) and how many of those were later reworked.
const staffHandled = async (
  storeId: string,
  userIds: string[],
  start: Date,
  end: Date,
  db: Db = prisma
): Promise<IStaffHandled[]> => {
  try {
    if (userIds.length === 0) return [];
    return await db.$queryRaw<IStaffHandled[]>`
      WITH reworked AS (
        SELECT DISTINCT e."orderId"
        FROM ${qualified("commerce_order_events")} e
        JOIN ${qualified("commerce_orders")} o ON o."id" = e."orderId"
        WHERE o."storeId" = ${storeId}::uuid AND o."placedAt" >= ${start} AND o."placedAt" < ${end}
          AND EXISTS (
            SELECT 1 FROM ${qualified("commerce_order_events")} p
            WHERE p."orderId" = e."orderId" AND p."at" < e."at" AND p."status" > e."status"))
      SELECT e."byUserId" AS "userId",
             count(DISTINCT e."orderId")::int AS "ordersHandled",
             count(DISTINCT e."orderId") FILTER (WHERE e."orderId" IN (SELECT "orderId" FROM reworked))::int AS "reworkedOrders"
      FROM ${qualified("commerce_order_events")} e
      JOIN ${qualified("commerce_orders")} o ON o."id" = e."orderId"
      WHERE o."storeId" = ${storeId}::uuid AND o."placedAt" >= ${start} AND o."placedAt" < ${end}
        AND e."byUserId" = ANY(${userIds}::text[])
      GROUP BY e."byUserId"`;
  } catch (error) {
    throw error;
  }
};

const openComplaints = async (storeIds: string[], db: Db = prisma): Promise<Map<string, number>> => {
  try {
    const groups = await db.complaint.groupBy({
      by: ["storeId"],
      where: { storeId: { in: storeIds }, status: { in: [...OPEN_COMPLAINT_STATUSES] } },
      _count: { _all: true },
    });
    return new Map(groups.map((g) => [g.storeId, g._count._all]));
  } catch (error) {
    throw error;
  }
};

const complaintsRaised = async (storeIds: string[], start: Date, end: Date, db: Db = prisma): Promise<Map<string, number>> => {
  try {
    const groups = await db.complaint.groupBy({
      by: ["storeId"],
      where: { storeId: { in: storeIds }, createdAt: { gte: start, lt: end } },
      _count: { _all: true },
    });
    return new Map(groups.map((g) => [g.storeId, g._count._all]));
  } catch (error) {
    throw error;
  }
};

// People assigned to the store who are not leaving, and whether each is clocked in today.
const staffOf = async (storeId: string, today: string, db: Db = prisma): Promise<IStaffMember[]> => {
  try {
    const rows = await db.hrEmployee.findMany({
      where: { storeId, status: { in: ["active", "on_leave", "notice"] } },
      select: {
        id: true,
        name: true,
        role: true,
        gatewayUserId: true,
        attendance: { where: { date: toDbDate(today), clockIn: { not: null }, clockOut: null }, select: { id: true }, take: 1 },
      },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      take: MAX_LIST,
    });
    return rows.map((row) => ({
      employeeId: row.id,
      name: row.name,
      role: row.role,
      gatewayUserId: row.gatewayUserId,
      onShift: row.attendance.length > 0,
    }));
  } catch (error) {
    throw error;
  }
};

const countOnShift = async (storeId: string, today: string, db: Db = prisma): Promise<number> => {
  try {
    return await db.hrAttendance.count({
      where: { storeId, date: toDbDate(today), clockIn: { not: null }, clockOut: null },
    });
  } catch (error) {
    throw error;
  }
};

// Machines with no daily check recorded today.
const machinesWithoutCheck = async (storeId: string, today: string, db: Db = prisma) => {
  try {
    const rows = await db.floorMachine.findMany({
      where: { storeId, checks: { none: { checkDate: toDbDate(today) } } },
      select: { id: true, name: true },
      orderBy: [{ code: "asc" }],
      take: MAX_LIST,
    });
    return rows.map((row) => ({ machineId: row.id, name: row.name }));
  } catch (error) {
    throw error;
  }
};

// Recurring services due today or overdue for the store's equipment still in use.
const servicingDue = async (storeId: string, today: string, db: Db = prisma) => {
  try {
    const rows = await db.equipmentMaintenanceTask.findMany({
      where: { nextDueOn: { lte: toDbDate(today) }, equipment: { storeId, status: { not: "retired" } } },
      select: { name: true, equipment: { select: { id: true, name: true } } },
      orderBy: [{ nextDueOn: "asc" }, { id: "asc" }],
      take: MAX_LIST,
    });
    return rows.map((row) => ({ equipmentId: row.equipment.id, name: row.equipment.name, task: row.name }));
  } catch (error) {
    throw error;
  }
};

export const StoreSignalsQuery = {
  metricsFor,
  countProcessed,
  countReworked,
  staffHandled,
  openComplaints,
  complaintsRaised,
  staffOf,
  countOnShift,
  machinesWithoutCheck,
  servicingDue,
};
