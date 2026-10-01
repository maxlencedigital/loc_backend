import type { Prisma } from "@prisma/client";
import { prisma } from "../DB/Prisma.Connection.Db.js";
import type {
  Fabric,
  ICustomerOrderExt,
  ICustomerOrderExtCreate,
  ICustomerOrderLine,
  IOrderListFilter,
  IOrderRow,
} from "../Models/CustomerAccount/CustomerAccount.Interface.js";
import type { OrderStatus } from "../Models/Order/OrderStatus.js";

export type Db = Prisma.TransactionClient;

type ExtRow = Omit<ICustomerOrderExt, "paymentMethod"> & { paymentMethod: string };
const toExt = (row: ExtRow): ICustomerOrderExt => ({
  ...row,
  paymentMethod: row.paymentMethod as ICustomerOrderExt["paymentMethod"],
});

const findByIdempotencyKey = async (customerId: string, key: string, db: Db = prisma): Promise<ICustomerOrderExt | null> => {
  try {
    const row = await db.customerOrder.findUnique({
      where: { customerId_idempotencyKey: { customerId, idempotencyKey: key } },
    });
    return row ? toExt(row) : null;
  } catch (error) {
    throw error;
  }
};

const findExtByOrderIds = async (orderIds: string[], db: Db = prisma): Promise<ICustomerOrderExt[]> => {
  try {
    if (orderIds.length === 0) return [];
    return (await db.customerOrder.findMany({ where: { orderId: { in: orderIds } } })).map(toExt);
  } catch (error) {
    throw error;
  }
};

const createExt = async (data: ICustomerOrderExtCreate, db: Db): Promise<ICustomerOrderExt> => {
  try {
    return toExt(await db.customerOrder.create({ data }));
  } catch (error) {
    throw error;
  }
};

const createLines = async (lines: ICustomerOrderLine[], db: Db): Promise<void> => {
  try {
    await db.customerOrderLine.createMany({ data: lines });
  } catch (error) {
    throw error;
  }
};

const findLinesByOrder = async (orderId: string, db: Db = prisma): Promise<ICustomerOrderLine[]> => {
  try {
    const rows = await db.customerOrderLine.findMany({
      where: { orderId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    return rows.map((row) => ({
      orderId: row.orderId,
      orderItemId: row.orderItemId,
      customerId: row.customerId,
      garmentTypeId: row.garmentTypeId,
      garmentProfileId: row.garmentProfileId,
      fabric: row.fabric as Fabric,
      note: row.note,
    }));
  } catch (error) {
    throw error;
  }
};

// The owner is part of the lookup, so a customer can never reach another's order.
const ownsOrder = async (customerId: string, orderId: string, db: Db = prisma): Promise<boolean> => {
  try {
    return (await db.order.findFirst({ where: { id: orderId, customerId }, select: { id: true } })) !== null;
  } catch (error) {
    throw error;
  }
};

// Row lock on the order for the rest of the transaction (a no-op UPDATE; raw SQL would not
// get the per-service schema). False when the order is not this customer's.
const lockOwned = async (customerId: string, orderId: string, db: Db): Promise<boolean> => {
  try {
    const { count } = await db.order.updateMany({ where: { id: orderId, customerId }, data: { updatedAt: new Date() } });
    return count > 0;
  } catch (error) {
    throw error;
  }
};

// "Booked" orders split into those with a pickup slot (app orders) and those without
// (walk-ins). Only the customer's own booked orders are looked at, a handful at most.
const bookedWithSlot = async (customerId: string, db: Db): Promise<string[]> => {
  const booked = await db.order.findMany({ where: { customerId, status: "booked" }, select: { id: true } });
  if (booked.length === 0) return [];
  const slotted = await db.customerOrder.findMany({
    where: { orderId: { in: booked.map((o) => o.id) } },
    select: { orderId: true },
  });
  return slotted.map((s) => s.orderId);
};

const listOwned = async (
  customerId: string,
  filter: IOrderListFilter,
  db: Db = prisma
): Promise<{ rows: IOrderRow[]; total: number }> => {
  try {
    const slotted = filter.hasPickupSlot === undefined ? null : await bookedWithSlot(customerId, db);
    const where: Prisma.OrderWhereInput = {
      customerId,
      ...(filter.statuses ? { status: { in: filter.statuses } } : {}),
      ...(slotted ? { id: filter.hasPickupSlot ? { in: slotted } : { notIn: slotted } } : {}),
      ...(filter.from || filter.to ? { placedAt: { gte: filter.from, lte: filter.to } } : {}),
    };
    const [rows, total] = await Promise.all([
      db.order.findMany({
        where,
        select: {
          id: true,
          ref: true,
          status: true,
          priority: true,
          paymentStatus: true,
          storeId: true,
          amountPaise: true,
          placedAt: true,
        },
        orderBy: [{ placedAt: "desc" }, { id: "asc" }],
        skip: filter.offset,
        take: filter.limit,
      }),
      db.order.count({ where }),
    ]);
    return { rows, total };
  } catch (error) {
    throw error;
  }
};

const updatePickup = async (
  orderId: string,
  pickup: { pickupSlotId: string; pickupFrom: Date; pickupTo: Date },
  db: Db
): Promise<void> => {
  try {
    await db.customerOrder.update({ where: { orderId }, data: pickup });
  } catch (error) {
    throw error;
  }
};

// Kilograms already promised to the plant: one SQL aggregate over the store's unfinished orders.
const sumOpenWeightGrams = async (storeId: string, statuses: OrderStatus[], db: Db = prisma): Promise<number> => {
  try {
    const result = await db.order.aggregate({
      where: { storeId, status: { in: statuses } },
      _sum: { weightGrams: true },
    });
    return result._sum.weightGrams ?? 0;
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

export const CustomerOrderQuery = { inTransaction,
  findByIdempotencyKey,
  findExtByOrderIds,
  createExt,
  createLines,
  findLinesByOrder,
  ownsOrder,
  lockOwned,
  listOwned,
  updatePickup,
  sumOpenWeightGrams,
};
