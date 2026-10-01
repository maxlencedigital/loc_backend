import type { Prisma } from "@prisma/client";
import { prisma } from "../DB/Prisma.Connection.Db.js";
import {
  ICustomerPayment,
  ICustomerPaymentCreate,
  ICustomerPaymentFilter,
  ICustomerPaymentUpdate,
  ISavedMethod,
  ISavedMethodCreate,
} from "../Models/CustomerPayment/CustomerPayment.Interface.js";

export type Db = Prisma.TransactionClient;

const inTransaction = async <T>(work: (tx: Db) => Promise<T>): Promise<T> => {
  try {
    return await prisma.$transaction(work);
  } catch (error) {
    throw error;
  }
};

const create = async (data: ICustomerPaymentCreate, db: Db = prisma): Promise<ICustomerPayment> => {
  try {
    return await db.customerPayment.create({ data });
  } catch (error) {
    throw error;
  }
};

const findByKey = async (
  customerUserId: string,
  idempotencyKey: string,
  db: Db = prisma
): Promise<ICustomerPayment | null> => {
  try {
    return await db.customerPayment.findFirst({ where: { customerUserId, idempotencyKey } });
  } catch (error) {
    throw error;
  }
};

/** The customer's own attempt for this order and gateway order id, or nothing. */
const findOwn = async (
  customerUserId: string,
  orderId: string,
  razorpayOrderId: string,
  db: Db = prisma
): Promise<ICustomerPayment | null> => {
  try {
    return await db.customerPayment.findFirst({ where: { customerUserId, orderId, razorpayOrderId } });
  } catch (error) {
    throw error;
  }
};

// Row lock until the transaction ends: two verifications of one attempt run one after the
// other, so the second finds it already captured and adds nothing.
const lock = async (id: string, db: Db): Promise<ICustomerPayment | null> => {
  try {
    const { count } = await db.customerPayment.updateMany({ where: { id }, data: { updatedAt: new Date() } });
    return count === 0 ? null : await db.customerPayment.findUnique({ where: { id } });
  } catch (error) {
    throw error;
  }
};

const update = async (id: string, data: ICustomerPaymentUpdate, db: Db): Promise<ICustomerPayment> => {
  try {
    return await db.customerPayment.update({ where: { id }, data });
  } catch (error) {
    throw error;
  }
};

// History shows attempts that reached a result; a checkout that was opened and abandoned
// ("created") is not a payment the customer made.
const search = async (
  filter: ICustomerPaymentFilter,
  db: Db = prisma
): Promise<{ items: ICustomerPayment[]; total: number }> => {
  try {
    const where: Prisma.CustomerPaymentWhereInput = {
      customerUserId: filter.customerUserId,
      status: { not: "created" },
      ...(filter.from || filter.to ? { createdAt: { gte: filter.from, lte: filter.to } } : {}),
    };
    const [items, total] = await Promise.all([
      db.customerPayment.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        skip: filter.page.offset,
        take: filter.page.limit,
      }),
      db.customerPayment.count({ where }),
    ]);
    return { items, total };
  } catch (error) {
    throw error;
  }
};

// ----------------------------------------------------------- saved methods
const listMethods = async (
  customerUserId: string,
  offset: number,
  limit: number,
  db: Db = prisma
): Promise<{ items: ISavedMethod[]; total: number }> => {
  try {
    const where = { customerUserId };
    const [items, total] = await Promise.all([
      db.savedPaymentMethod.findMany({
        where,
        orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }, { id: "asc" }],
        skip: offset,
        take: limit,
      }),
      db.savedPaymentMethod.count({ where }),
    ]);
    return { items, total };
  } catch (error) {
    throw error;
  }
};

const countMethods = async (customerUserId: string, db: Db = prisma): Promise<number> => {
  try {
    return await db.savedPaymentMethod.count({ where: { customerUserId } });
  } catch (error) {
    throw error;
  }
};

const findMethodByToken = async (
  customerUserId: string,
  providerToken: string,
  db: Db = prisma
): Promise<ISavedMethod | null> => {
  try {
    return await db.savedPaymentMethod.findUnique({
      where: { customerUserId_providerToken: { customerUserId, providerToken } },
    });
  } catch (error) {
    throw error;
  }
};

const clearDefault = async (customerUserId: string, db: Db): Promise<void> => {
  try {
    await db.savedPaymentMethod.updateMany({
      where: { customerUserId, isDefault: true },
      data: { isDefault: false, defaultKey: null },
    });
  } catch (error) {
    throw error;
  }
};

const createMethod = async (data: ISavedMethodCreate, db: Db): Promise<ISavedMethod> => {
  try {
    return await db.savedPaymentMethod.create({
      data: { ...data, defaultKey: data.isDefault ? data.customerUserId : null },
    });
  } catch (error) {
    throw error;
  }
};

/** Deletes the customer's own method and says whether it existed and was the default. */
const deleteMethod = async (
  customerUserId: string,
  id: string,
  db: Db
): Promise<{ found: boolean; wasDefault: boolean }> => {
  try {
    const method = await db.savedPaymentMethod.findFirst({ where: { id, customerUserId } });
    if (!method) return { found: false, wasDefault: false };
    const { count } = await db.savedPaymentMethod.deleteMany({ where: { id, customerUserId } });
    return { found: count > 0, wasDefault: count > 0 && method.isDefault };
  } catch (error) {
    throw error;
  }
};

const promoteNewest = async (customerUserId: string, db: Db): Promise<void> => {
  try {
    const newest = await db.savedPaymentMethod.findFirst({
      where: { customerUserId },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      select: { id: true },
    });
    if (newest) {
      await db.savedPaymentMethod.update({
        where: { id: newest.id },
        data: { isDefault: true, defaultKey: customerUserId },
      });
    }
  } catch (error) {
    throw error;
  }
};

export const CustomerPaymentQuery = {
  inTransaction,
  create,
  findByKey,
  findOwn,
  lock,
  update,
  search,
  listMethods,
  countMethods,
  findMethodByToken,
  clearDefault,
  createMethod,
  deleteMethod,
  promoteNewest,
};
