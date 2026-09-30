import type { Prisma } from "@prisma/client";
import { prisma } from "../DB/Prisma.Connection.Db.js";
import {
  ICareProfile,
  IOrder,
  IOrderCreate,
  IOrderFilter,
  IStatusChange,
} from "../Models/Order/Order.Interface.js";
import { OrderStatus } from "../Models/Order/OrderStatus.js";

export type Db = Prisma.TransactionClient;

const ORDER_REF_COUNTER = "order_ref";

const orderInclude = {
  customer: { select: { name: true, phone: true } },
  items: { orderBy: { position: "asc" } },
  events: { orderBy: [{ at: "asc" }, { id: "asc" }] },
} satisfies Prisma.OrderInclude;

type OrderRow = Prisma.OrderGetPayload<{ include: typeof orderInclude }>;

const toOrder = ({ customer, care, items, events, ...order }: OrderRow): IOrder => ({
  ...order,
  customerName: customer.name,
  customerPhone: customer.phone,
  care: care as unknown as ICareProfile,
  items: items.map(({ orderId: _orderId, position: _position, ...item }) => item),
  events: events.map(({ orderId: _orderId, ...event }) => event),
});

const inTransaction = async <T>(work: (tx: Db) => Promise<T>): Promise<T> => {
  try {
    return await prisma.$transaction(work);
  } catch (error) {
    throw error;
  }
};

// One atomic UPDATE ... RETURNING. Its row lock is held until the booking commits, so
// concurrent bookings queue for a number instead of racing to read the same maximum.
const nextOrderNumber = async (db: Db): Promise<number> => {
  try {
    const counter = await db.sequenceCounter.update({
      where: { name: ORDER_REF_COUNTER },
      data: { value: { increment: 1 } },
    });
    return counter.value;
  } catch (error) {
    throw error;
  }
};

const create = async (ref: string, data: IOrderCreate, db: Db): Promise<IOrder> => {
  try {
    const { items, firstEvent, ...order } = data;
    const row = await db.order.create({
      data: {
        ...order,
        ref,
        care: order.care as unknown as Prisma.InputJsonValue,
        items: { create: items.map((item, position) => ({ ...item, position })) },
        events: { create: [{ status: "booked", ...firstEvent }] },
      },
      include: orderInclude,
    });
    return toOrder(row);
  } catch (error) {
    throw error;
  }
};

// A scope narrows to one store; null means every store.
const findById = async (id: string, scope: string | null, db: Db = prisma): Promise<IOrder | null> => {
  try {
    const row = await db.order.findFirst({
      where: { id, ...(scope ? { storeId: scope } : {}) },
      include: orderInclude,
    });
    return row ? toOrder(row) : null;
  } catch (error) {
    throw error;
  }
};

// Takes a row lock until the transaction ends. Two status changes for one order would
// otherwise both read the old status and each append an event. A no-op UPDATE is the
// lock: raw SQL would not get the per-service schema the driver adapter applies.
const lockById = async (id: string, scope: string | null, db: Db): Promise<IOrder | null> => {
  try {
    const { count } = await db.order.updateMany({
      where: { id, ...(scope ? { storeId: scope } : {}) },
      data: { updatedAt: new Date() },
    });
    return count === 0 ? null : await findById(id, scope, db);
  } catch (error) {
    throw error;
  }
};

const applyStatus = async (id: string, change: IStatusChange, db: Db): Promise<IOrder> => {
  try {
    const row = await db.order.update({
      where: { id },
      data: {
        status: change.status,
        events: {
          create: { status: change.status, note: change.note, byName: change.byName, byUserId: change.byUserId },
        },
      },
      include: orderInclude,
    });
    return toOrder(row);
  } catch (error) {
    throw error;
  }
};

const search = async (filter: IOrderFilter, db: Db = prisma): Promise<IOrder[]> => {
  try {
    const q = filter.q?.trim();
    const rows = await db.order.findMany({
      where: {
        ...(filter.storeId ? { storeId: filter.storeId } : {}),
        ...(filter.statuses ? { status: { in: filter.statuses } } : {}),
        ...(filter.priority ? { priority: filter.priority } : {}),
        ...(filter.paymentStatus ? { paymentStatus: filter.paymentStatus } : {}),
        ...(filter.customerId ? { customerId: filter.customerId } : {}),
        ...(filter.from || filter.to ? { placedAt: { gte: filter.from, lte: filter.to } } : {}),
        ...(q
          ? {
              OR: [
                { ref: { contains: q, mode: "insensitive" } },
                { customer: { name: { contains: q, mode: "insensitive" } } },
                { customer: { phone: { contains: q } } },
              ],
            }
          : {}),
      },
      include: orderInclude,
      orderBy: [{ placedAt: "desc" }, { id: "asc" }],
      take: filter.limit,
    });
    return rows.map(toOrder);
  } catch (error) {
    throw error;
  }
};

const countByStatus = async (
  scope: string | null,
  statuses: OrderStatus[],
  db: Db = prisma
): Promise<Partial<Record<OrderStatus, number>>> => {
  try {
    const groups = await db.order.groupBy({
      by: ["status"],
      where: { status: { in: statuses }, ...(scope ? { storeId: scope } : {}) },
      _count: { _all: true },
    });
    return Object.fromEntries(groups.map((g) => [g.status, g._count._all]));
  } catch (error) {
    throw error;
  }
};

export const OrderQuery = {
  inTransaction,
  nextOrderNumber,
  create,
  findById,
  lockById,
  applyStatus,
  search,
  countByStatus,
};
