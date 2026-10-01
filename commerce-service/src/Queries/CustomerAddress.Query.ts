import type { Prisma } from "@prisma/client";
import { prisma } from "../DB/Prisma.Connection.Db.js";
import type { AddressLabel, IAddress, IAddressInput } from "../Models/CustomerAccount/CustomerAccount.Interface.js";

export type Db = Prisma.TransactionClient;

const toAddress = (row: { label: string } & Omit<IAddress, "label">): IAddress => ({
  ...row,
  label: row.label as AddressLabel,
});

const list = async (
  customerId: string,
  offset: number,
  limit: number,
  db: Db = prisma
): Promise<{ items: IAddress[]; total: number }> => {
  try {
    const [rows, total] = await Promise.all([
      db.customerAddress.findMany({
        where: { customerId },
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        skip: offset,
        take: limit,
      }),
      db.customerAddress.count({ where: { customerId } }),
    ]);
    return { items: rows.map(toAddress), total };
  } catch (error) {
    throw error;
  }
};

// The owner is part of the lookup: another customer's address is simply not found.
const findOwned = async (customerId: string, id: string, db: Db = prisma): Promise<IAddress | null> => {
  try {
    const row = await db.customerAddress.findFirst({ where: { id, customerId } });
    return row ? toAddress(row) : null;
  } catch (error) {
    throw error;
  }
};

const count = async (customerId: string, db: Db = prisma): Promise<number> => {
  try {
    return await db.customerAddress.count({ where: { customerId } });
  } catch (error) {
    throw error;
  }
};

const create = async (customerId: string, data: IAddressInput, db: Db = prisma): Promise<IAddress> => {
  try {
    return toAddress(await db.customerAddress.create({ data: { ...data, customerId } }));
  } catch (error) {
    throw error;
  }
};

const update = async (
  customerId: string,
  id: string,
  data: Partial<IAddressInput>,
  db: Db = prisma
): Promise<IAddress | null> => {
  try {
    const { count: changed } = await db.customerAddress.updateMany({ where: { id, customerId }, data });
    return changed === 0 ? null : await findOwned(customerId, id, db);
  } catch (error) {
    throw error;
  }
};

const remove = async (customerId: string, id: string, db: Db = prisma): Promise<boolean> => {
  try {
    const { count: removed } = await db.customerAddress.deleteMany({ where: { id, customerId } });
    return removed > 0;
  } catch (error) {
    throw error;
  }
};

const findLatest = async (customerId: string, db: Db = prisma): Promise<IAddress | null> => {
  try {
    const row = await db.customerAddress.findFirst({
      where: { customerId },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    });
    return row ? toAddress(row) : null;
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

export const CustomerAddressQuery = { inTransaction, list, findOwned, count, create, update, remove, findLatest };
