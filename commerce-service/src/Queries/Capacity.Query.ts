import { Prisma } from "@prisma/client";
import { prisma } from "../DB/Prisma.Connection.Db.js";
import { DB_SCHEMA } from "../DB/DatabaseUrl.js";
import type {
  ICapacitySetting,
  IDayLoad,
  IExpressCandidate,
  IMachineAggregate,
} from "../Models/StoreFloor/StoreFloor.Interface.js";
import type { OrderStatus } from "../Models/Order/OrderStatus.js";
import type { Db } from "./Floor.Transaction.js";

// A raw statement does not get the per-service schema the Prisma client applies, so the table
// is qualified here. The name comes from our own environment and is checked before it is quoted.
const SAFE_SCHEMA = /^[A-Za-z_][A-Za-z0-9_]*$/;
if (!SAFE_SCHEMA.test(DB_SCHEMA)) throw new Error("DB_SCHEMA is not a valid schema name.");
const ORDERS = Prisma.raw(`"${DB_SCHEMA}"."commerce_orders"`);

// Stores work on Indian time; "tomorrow's load" means the local calendar day.
const STORE_TIME_ZONE = "Asia/Kolkata";
const scopeWhere = (storeId: string | null) => (storeId ? { storeId } : {});

const settings = async (storeId: string | null, db: Db = prisma): Promise<ICapacitySetting[]> => {
  try {
    return await db.capacitySetting.findMany({
      where: scopeWhere(storeId),
      select: { storeId: true, dailyKg: true, expressReservePct: true },
      take: 500,
    });
  } catch (error) {
    throw error;
  }
};

const saveSetting = async (data: ICapacitySetting, db: Db = prisma): Promise<ICapacitySetting> => {
  try {
    const { storeId, ...rest } = data;
    return await db.capacitySetting.upsert({
      where: { storeId },
      create: data,
      update: rest,
      select: { storeId: true, dailyKg: true, expressReservePct: true },
    });
  } catch (error) {
    throw error;
  }
};

const machineAggregates = async (storeId: string | null, db: Db = prisma): Promise<IMachineAggregate[]> => {
  try {
    const groups = await db.floorMachine.groupBy({
      by: ["type", "state"],
      where: scopeWhere(storeId),
      _count: { _all: true },
      _sum: { capacityGrams: true },
    });
    return groups.map((g) => ({ type: g.type, state: g.state, count: g._count._all, capacityGrams: g._sum.capacityGrams ?? 0 }));
  } catch (error) {
    throw error;
  }
};

interface IDayRow {
  day: string;
  orders: number;
  grams: bigint;
  express: bigint;
}

// One aggregate over the open orders due in [fromDate, toDate): a day's load is the weight of the
// orders promised that day, and an order already late counts against the first day. Weight is the
// weighed kilos when the order has any, else a per-piece estimate for orders sold by the piece.
const dayLoads = async (
  storeId: string | null,
  fromDate: string,
  toDate: string,
  openStatuses: OrderStatus[],
  gramsPerPiece: number,
  db: Db = prisma
): Promise<IDayLoad[]> => {
  try {
    const rows = await db.$queryRaw<IDayRow[]>(Prisma.sql`
      SELECT to_char(GREATEST((o."promisedAt" AT TIME ZONE ${STORE_TIME_ZONE})::date, ${fromDate}::date), 'YYYY-MM-DD') AS day,
             COUNT(*)::int AS orders,
             COALESCE(SUM(CASE WHEN o."weightGrams" > 0 THEN o."weightGrams" ELSE o."pieces" * ${gramsPerPiece} END), 0)::bigint AS grams,
             COALESCE(SUM(CASE WHEN o."priority"::text = 'express' THEN CASE WHEN o."weightGrams" > 0 THEN o."weightGrams" ELSE o."pieces" * ${gramsPerPiece} END ELSE 0 END), 0)::bigint AS express
      FROM ${ORDERS} o
      WHERE o."status"::text IN (${Prisma.join(openStatuses)})
        AND (o."promisedAt" AT TIME ZONE ${STORE_TIME_ZONE})::date < ${toDate}::date
        ${storeId ? Prisma.sql`AND o."storeId" = ${storeId}::uuid` : Prisma.empty}
      GROUP BY 1
      ORDER BY 1`);
    return rows.map((r) => ({ date: r.day, orders: Number(r.orders), committedGrams: Number(r.grams), expressGrams: Number(r.express) }));
  } catch (error) {
    throw error;
  }
};

// The open express orders closest to their promise: bounded, so it is the most urgent that are judged.
const expressCandidates = async (storeId: string | null, statuses: OrderStatus[], limit: number, db: Db = prisma): Promise<IExpressCandidate[]> => {
  try {
    const rows = await db.order.findMany({
      where: { ...scopeWhere(storeId), priority: "express", status: { in: statuses } },
      select: { id: true, ref: true, storeId: true, status: true, promisedAt: true },
      orderBy: [{ promisedAt: "asc" }, { id: "asc" }],
      take: limit,
    });
    return rows.map((r) => ({ orderId: r.id, ref: r.ref, storeId: r.storeId, status: r.status, promisedAt: r.promisedAt }));
  } catch (error) {
    throw error;
  }
};

export const CapacityQuery = { settings, saveSetting, machineAggregates, dayLoads, expressCandidates };
