import type { Prisma } from "@prisma/client";
import { prisma } from "../DB/Prisma.Connection.Db.js";
import type { Db } from "./Db.js";
import type { ICustomerOrder, ICustomerStat, IWinBack } from "../Models/Customer/Customer.Interface.js";
import type { NotificationChannel } from "../Models/Notification/Notification.Interface.js";

// What the service resolved a named segment into; the Query only translates it to SQL.
export interface IAudienceCriteria {
  storeIds?: string[];
  minOrders?: number;
  minSpentPaise?: number;
  firstOrderAfter?: Date;
  lastOrderBefore?: Date;
  lastOrderAfter?: Date;
}

const where = (c: IAudienceCriteria): Prisma.CustomerStatWhereInput => ({
  ...(c.storeIds && c.storeIds.length > 0 ? { lastStoreId: { in: c.storeIds } } : {}),
  ...(c.minOrders ? { orderCount: { gte: c.minOrders } } : {}),
  ...(c.minSpentPaise ? { totalSpentPaise: { gte: c.minSpentPaise } } : {}),
  ...(c.firstOrderAfter ? { firstOrderAt: { gt: c.firstOrderAfter } } : {}),
  ...(c.lastOrderBefore || c.lastOrderAfter
    ? {
        lastOrderAt: {
          ...(c.lastOrderBefore ? { lt: c.lastOrderBefore } : {}),
          ...(c.lastOrderAfter ? { gt: c.lastOrderAfter } : {}),
        },
      }
    : {}),
});

const toStat = (row: ICustomerStat): ICustomerStat => ({
  customerId: row.customerId,
  orderCount: row.orderCount,
  totalSpentPaise: row.totalSpentPaise,
  firstOrderAt: row.firstOrderAt,
  lastOrderAt: row.lastOrderAt,
  lastStoreId: row.lastStoreId,
});

const insertOrder = async (order: ICustomerOrder, db: Db): Promise<boolean> => {
  try {
    const { count } = await db.customerOrder.createMany({ data: [order], skipDuplicates: true });
    return count === 1;
  } catch (error) {
    throw error;
  }
};

const findOrder = async (orderRef: string, db: Db = prisma): Promise<ICustomerOrder | null> => {
  try {
    return (await db.customerOrder.findUnique({ where: { orderRef } })) as ICustomerOrder | null;
  } catch (error) {
    throw error;
  }
};

// Creates the customer's stat row if needed and holds its row lock until the transaction ends.
const lockStat = async (customerId: string, first: { at: Date; storeId: string | null }, db: Db): Promise<ICustomerStat> => {
  try {
    await db.customerStat.createMany({
      data: [{ customerId, orderCount: 0, totalSpentPaise: 0, firstOrderAt: first.at, lastOrderAt: first.at, lastStoreId: first.storeId }],
      skipDuplicates: true,
    });
    await db.customerStat.updateMany({ where: { customerId }, data: { updatedAt: new Date() } });
    return toStat((await db.customerStat.findUniqueOrThrow({ where: { customerId } })) as ICustomerStat);
  } catch (error) {
    throw error;
  }
};

const addOrderToStat = async (
  customerId: string,
  change: { amountPaise: number; firstOrderAt: Date; lastOrderAt: Date; lastStoreId: string | null },
  db: Db
): Promise<void> => {
  try {
    await db.customerStat.updateMany({
      where: { customerId },
      data: {
        orderCount: { increment: 1 },
        totalSpentPaise: { increment: change.amountPaise },
        firstOrderAt: change.firstOrderAt,
        lastOrderAt: change.lastOrderAt,
        lastStoreId: change.lastStoreId,
      },
    });
  } catch (error) {
    throw error;
  }
};

const findStat = async (customerId: string): Promise<ICustomerStat | null> => {
  try {
    const row = await prisma.customerStat.findUnique({ where: { customerId } });
    return row ? toStat(row as ICustomerStat) : null;
  } catch (error) {
    throw error;
  }
};

const listOrders = async (customerId: string, limit: number): Promise<ICustomerOrder[]> => {
  try {
    return (await prisma.customerOrder.findMany({
      where: { customerId },
      orderBy: { completedAt: "desc" },
      take: limit,
    })) as ICustomerOrder[];
  } catch (error) {
    throw error;
  }
};

/** Keyset batch: ids after `after`, ascending, at most `limit`. Never loads the whole audience. */
const audienceBatch = async (criteria: IAudienceCriteria, after: string | null, limit: number): Promise<string[]> => {
  try {
    const rows = await prisma.customerStat.findMany({
      where: { ...where(criteria), ...(after ? { customerId: { gt: after } } : {}) },
      orderBy: { customerId: "asc" },
      select: { customerId: true },
      take: limit,
    });
    return rows.map((r) => r.customerId);
  } catch (error) {
    throw error;
  }
};

const audienceCount = async (criteria: IAudienceCriteria): Promise<number> => {
  try {
    return await prisma.customerStat.count({ where: where(criteria) });
  } catch (error) {
    throw error;
  }
};

/** Stat rows, longest-silent first: the retention list, always bounded by `limit`. */
const listByRecency = async (criteria: IAudienceCriteria, limit: number): Promise<ICustomerStat[]> => {
  try {
    const rows = await prisma.customerStat.findMany({ where: where(criteria), orderBy: { lastOrderAt: "asc" }, take: limit });
    return rows.map((r) => toStat(r as ICustomerStat));
  } catch (error) {
    throw error;
  }
};

const findStatsByIds = async (ids: string[]): Promise<ICustomerStat[]> => {
  try {
    const rows = await prisma.customerStat.findMany({ where: { customerId: { in: ids } } });
    return rows.map((r) => toStat(r as ICustomerStat));
  } catch (error) {
    throw error;
  }
};

const insertWinBack = async (data: {
  customerId: string;
  channel: NotificationChannel;
  couponId: string | null;
  notificationId: string | null;
}): Promise<void> => {
  try {
    await prisma.winBack.create({ data });
  } catch (error) {
    throw error;
  }
};

const recentWinBacks = async (since: Date, limit: number): Promise<IWinBack[]> => {
  try {
    return (await prisma.winBack.findMany({
      where: { createdAt: { gte: since } },
      orderBy: { createdAt: "desc" },
      select: { customerId: true, createdAt: true },
      take: limit,
    })) as IWinBack[];
  } catch (error) {
    throw error;
  }
};

export const CustomerQuery = {
  insertOrder,
  findOrder,
  lockStat,
  addOrderToStat,
  findStat,
  listOrders,
  audienceBatch,
  audienceCount,
  listByRecency,
  findStatsByIds,
  insertWinBack,
  recentWinBacks,
};
