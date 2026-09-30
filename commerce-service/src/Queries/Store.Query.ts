import type { Prisma } from "@prisma/client";
import { prisma } from "../DB/Prisma.Connection.Db.js";
import { IStore, IStoreCreate, IStoreUpdate, StoreStatus } from "../Models/Store/Store.Interface.js";

export type Db = Prisma.TransactionClient;

const create = async (data: IStoreCreate, db: Db = prisma): Promise<IStore> => {
  try {
    return await db.store.create({ data });
  } catch (error) {
    throw error;
  }
};

// A scope narrows to one store; null means every store.
const list = async (scope: string | null, status?: StoreStatus, db: Db = prisma): Promise<IStore[]> => {
  try {
    return await db.store.findMany({
      where: { ...(scope ? { id: scope } : {}), ...(status ? { status } : {}) },
      orderBy: [{ code: "asc" }],
    });
  } catch (error) {
    throw error;
  }
};

const findById = async (id: string, scope: string | null, db: Db = prisma): Promise<IStore | null> => {
  try {
    // A store-bound caller can only ever read their own store: any other id is simply not found.
    if (scope && scope !== id) return null;
    return await db.store.findUnique({ where: { id } });
  } catch (error) {
    throw error;
  }
};

const update = async (id: string, data: IStoreUpdate, db: Db = prisma): Promise<IStore> => {
  try {
    return await db.store.update({ where: { id }, data });
  } catch (error) {
    throw error;
  }
};

export const StoreQuery = { create, list, findById, update };
