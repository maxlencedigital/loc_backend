import type { Prisma } from "@prisma/client";
import { prisma } from "../DB/Prisma.Connection.Db.js";
import { ICustomer, ICustomerCreate, ICustomerFilter, ICustomerUpdate } from "../Models/Customer/Customer.Interface.js";

export type Db = Prisma.TransactionClient;

const create = async (data: ICustomerCreate, db: Db = prisma): Promise<ICustomer> => {
  try {
    return await db.customer.create({ data });
  } catch (error) {
    throw error;
  }
};

const search = async (filter: ICustomerFilter, db: Db = prisma): Promise<ICustomer[]> => {
  try {
    const q = filter.q?.trim();
    return await db.customer.findMany({
      where: {
        ...(filter.storeId ? { storeId: filter.storeId } : {}),
        ...(filter.type ? { type: filter.type } : {}),
        ...(q
          ? {
              OR: [
                { name: { contains: q, mode: "insensitive" } },
                { phone: { contains: q } },
                { email: { contains: q, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: filter.limit,
    });
  } catch (error) {
    throw error;
  }
};

// Passing the caller's store makes another store's customer simply not found.
const findById = async (id: string, scope: string | null, db: Db = prisma): Promise<ICustomer | null> => {
  try {
    return await db.customer.findFirst({ where: { id, ...(scope ? { storeId: scope } : {}) } });
  } catch (error) {
    throw error;
  }
};

const update = async (id: string, data: ICustomerUpdate, db: Db = prisma): Promise<ICustomer> => {
  try {
    return await db.customer.update({ where: { id }, data });
  } catch (error) {
    throw error;
  }
};

// Runs in the booking's transaction so the totals move only if the order is saved.
const recordOrder = async (id: string, amountPaise: number, at: Date, db: Db): Promise<void> => {
  try {
    await db.customer.update({
      where: { id },
      data: {
        orderCount: { increment: 1 },
        lifetimeValuePaise: { increment: amountPaise },
        lastOrderAt: at,
      },
    });
  } catch (error) {
    throw error;
  }
};

// Undoes recordOrder for a cancelled order; lastOrderAt stays, since the customer did visit.
const reverseOrder = async (id: string, amountPaise: number, db: Db): Promise<void> => {
  try {
    await db.customer.update({
      where: { id },
      data: { orderCount: { decrement: 1 }, lifetimeValuePaise: { decrement: amountPaise } },
    });
  } catch (error) {
    throw error;
  }
};

export const CustomerQuery = { create, search, findById, update, recordOrder, reverseOrder };
