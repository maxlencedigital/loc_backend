import { Prisma } from "@prisma/client";
import { prisma } from "../DB/Prisma.Connection.Db.js";
import { DB_SCHEMA } from "../DB/DatabaseUrl.js";
import type {
  IInternalOrder,
  IOrderSummaryFilter,
  IOrderSummaryRows,
} from "../Models/CustomerAccount/CustomerAccount.Interface.js";
import type { OrderPaymentStatus } from "../Models/Order/Order.Interface.js";
import type { OrderStatus } from "../Models/Order/OrderStatus.js";

export type Db = Prisma.TransactionClient;

const findOrder = async (id: string, db: Db = prisma): Promise<IInternalOrder | null> => {
  try {
    const row = await db.order.findUnique({
      where: { id },
      select: {
        id: true,
        ref: true,
        storeId: true,
        customerId: true,
        status: true,
        priority: true,
        paymentStatus: true,
        amountPaise: true,
        address: true,
        promisedAt: true,
        customer: { select: { name: true, phone: true } },
      },
    });
    if (!row) return null;
    const { customer, ...order } = row;
    return { ...order, customerName: customer.name, customerPhone: customer.phone };
  } catch (error) {
    throw error;
  }
};

const findPaidPaise = async (orderId: string, db: Db = prisma): Promise<number | null> => {
  try {
    const row = await db.orderPaidTotal.findUnique({ where: { orderId }, select: { paidPaise: true } });
    return row ? row.paidPaise : null;
  } catch (error) {
    throw error;
  }
};

const upsertPaidPaise = async (orderId: string, paidPaise: number, db: Db): Promise<void> => {
  try {
    await db.orderPaidTotal.upsert({
      where: { orderId },
      create: { orderId, paidPaise },
      update: { paidPaise },
    });
  } catch (error) {
    throw error;
  }
};

const setPaymentStatus = async (orderId: string, paymentStatus: OrderPaymentStatus, db: Db): Promise<void> => {
  try {
    await db.order.update({ where: { id: orderId }, data: { paymentStatus } });
  } catch (error) {
    throw error;
  }
};

// Order counts and revenue over a placed-at range, never row lists. Cancelled orders are
// counted in byStatus only; orders and revenue are the live ones.
const summarise = async (filter: IOrderSummaryFilter, db: Db = prisma): Promise<IOrderSummaryRows> => {
  try {
    const where: Prisma.OrderWhereInput = {
      placedAt: { gte: filter.from, lt: filter.to },
      ...(filter.storeId ? { storeId: filter.storeId } : {}),
    };
    const [statuses, stores, days] = await Promise.all([
      db.order.groupBy({ by: ["status"], where, _count: { _all: true } }),
      db.order.groupBy({
        by: ["storeId"],
        where: { ...where, status: { not: "cancelled" } },
        _count: { _all: true },
        _sum: { amountPaise: true },
      }),
      // Prisma cannot group by a calendar day, and a raw query does not get the per-service
      // schema, so the table is named with this service's own schema.
      db.$queryRaw<{ date: string; orders: bigint; revenue: bigint | null }[]>(Prisma.sql`
        SELECT to_char(("placedAt" AT TIME ZONE 'Asia/Kolkata')::date, 'YYYY-MM-DD') AS date,
               COUNT(*) AS orders,
               COALESCE(SUM("amountPaise"), 0) AS revenue
        FROM ${Prisma.raw(`"${DB_SCHEMA}"."commerce_orders"`)}
        WHERE "placedAt" >= ${filter.from} AND "placedAt" < ${filter.to}
          AND "status" <> 'cancelled'
          ${filter.storeId ? Prisma.sql`AND "storeId" = ${filter.storeId}::uuid` : Prisma.empty}
        GROUP BY 1
        ORDER BY 1`),
    ]);
    return {
      byStatus: statuses.map((s) => ({ status: s.status as OrderStatus, orders: s._count._all })),
      byStore: stores.map((s) => ({
        storeId: s.storeId,
        orders: s._count._all,
        revenuePaise: s._sum.amountPaise ?? 0,
      })),
      byDay: days.map((d) => ({ date: d.date, orders: Number(d.orders), revenuePaise: Number(d.revenue ?? 0) })),
    };
  } catch (error) {
    throw error;
  }
};

const inTransaction = async <T>(work: (tx: Db) => Promise<T>): Promise<T> => {
  try {
    return await prisma.$transaction(work);
  } catch (error) {
    throw error;
  }
};

export const OrderInternalQuery = { inTransaction, findOrder, findPaidPaise, upsertPaidPaise, setPaymentStatus, summarise };
