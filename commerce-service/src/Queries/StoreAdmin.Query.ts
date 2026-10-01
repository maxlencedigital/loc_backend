import type { Prisma } from "@prisma/client";
import { Page, PageRequest, toPage } from "../../commons/Utils/Pagination.js";
import { prisma } from "../DB/Prisma.Connection.Db.js";
import { IArea, IAreaWrite, ICustomerStoreRow } from "../Models/StoreAdmin/StoreAdmin.Interface.js";

export type Db = Prisma.TransactionClient;

const memberSelect = (onlyStore: string | null) =>
  ({ select: { storeId: true }, ...(onlyStore ? { where: { storeId: onlyStore } } : {}), orderBy: { storeId: "asc" } }) as const;

type AreaRow = Prisma.StoreAreaGetPayload<{ include: { members: { select: { storeId: true } } } }>;

const toArea = ({ members, ...area }: AreaRow): IArea => ({ ...area, storeIds: members.map((m) => m.storeId) });

const inTransaction = async <T>(work: (tx: Db) => Promise<T>): Promise<T> => {
  try {
    return await prisma.$transaction(work);
  } catch (error) {
    throw error;
  }
};

// `onlyStore` narrows both the areas listed and the members shown to one store (a store-bound
// caller never learns which other stores share the area).
const findArea = async (id: string, onlyStore: string | null, db: Db = prisma): Promise<IArea | null> => {
  try {
    const row = await db.storeArea.findFirst({
      where: { id, ...(onlyStore ? { members: { some: { storeId: onlyStore } } } : {}) },
      include: { members: memberSelect(onlyStore) },
    });
    return row ? toArea(row) : null;
  } catch (error) {
    throw error;
  }
};

const listAreas = async (onlyStore: string | null, page: PageRequest, db: Db = prisma): Promise<Page<IArea>> => {
  try {
    const where = onlyStore ? { members: { some: { storeId: onlyStore } } } : {};
    const [rows, total] = await Promise.all([
      db.storeArea.findMany({
        where,
        include: { members: memberSelect(onlyStore) },
        orderBy: [{ name: "asc" }, { id: "asc" }],
        skip: page.offset,
        take: page.limit,
      }),
      db.storeArea.count({ where }),
    ]);
    return toPage(rows.map(toArea), total, page);
  } catch (error) {
    throw error;
  }
};

const createArea = async (data: IAreaWrite, db: Db): Promise<string> => {
  try {
    return (await db.storeArea.create({ data, select: { id: true } })).id;
  } catch (error) {
    throw error;
  }
};

const updateArea = async (id: string, data: Partial<IAreaWrite>, db: Db): Promise<void> => {
  try {
    await db.storeArea.update({ where: { id }, data });
  } catch (error) {
    throw error;
  }
};

const deleteArea = async (id: string, db: Db): Promise<void> => {
  try {
    await db.storeArea.delete({ where: { id } });
  } catch (error) {
    throw error;
  }
};

// Replaces the area's stores. The unique store column refuses a store that is already in
// another area, which the service turns into a 409.
const setMembers = async (areaId: string, storeIds: string[], db: Db): Promise<void> => {
  try {
    await db.storeAreaMember.deleteMany({ where: { areaId } });
    if (storeIds.length > 0) {
      await db.storeAreaMember.createMany({ data: storeIds.map((storeId) => ({ areaId, storeId })) });
    }
  } catch (error) {
    throw error;
  }
};

const countMembers = async (areaId: string, db: Db = prisma): Promise<number> => {
  try {
    return await db.storeAreaMember.count({ where: { areaId } });
  } catch (error) {
    throw error;
  }
};

/** The ids among `ids` that are real stores. */
const existingStoreIds = async (ids: string[], db: Db = prisma): Promise<string[]> => {
  try {
    const rows = await db.store.findMany({ where: { id: { in: ids } }, select: { id: true } });
    return rows.map((r) => r.id);
  } catch (error) {
    throw error;
  }
};

const storeNames = async (ids: string[], db: Db = prisma): Promise<Map<string, { name: string; code: string }>> => {
  try {
    const rows = await db.store.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, code: true } });
    return new Map(rows.map((r) => [r.id, { name: r.name, code: r.code }]));
  } catch (error) {
    throw error;
  }
};

const MAX_COMPARED_STORES = 50;

const listStoresForCompare = async (db: Db = prisma): Promise<{ id: string; name: string; code: string }[]> => {
  try {
    return await db.store.findMany({
      select: { id: true, name: true, code: true },
      orderBy: [{ code: "asc" }],
      take: MAX_COMPARED_STORES,
    });
  } catch (error) {
    throw error;
  }
};

// One customer's non-cancelled orders grouped by the store that took them.
const ordersByStore = async (customerId: string, onlyStore: string | null, db: Db = prisma): Promise<ICustomerStoreRow[]> => {
  try {
    const groups = await db.order.groupBy({
      by: ["storeId"],
      where: { customerId, status: { not: "cancelled" }, ...(onlyStore ? { storeId: onlyStore } : {}) },
      _count: { _all: true },
      _sum: { amountPaise: true },
      _max: { placedAt: true },
      orderBy: { _max: { placedAt: "desc" } },
    });
    return groups.map((g) => ({
      storeId: g.storeId,
      orders: g._count._all,
      spendPaise: g._sum.amountPaise ?? 0,
      lastOrderAt: g._max.placedAt,
    }));
  } catch (error) {
    throw error;
  }
};

export const StoreAdminQuery = {
  inTransaction,
  findArea,
  listAreas,
  createArea,
  updateArea,
  deleteArea,
  setMembers,
  countMembers,
  existingStoreIds,
  storeNames,
  listStoresForCompare,
  ordersByStore,
};
