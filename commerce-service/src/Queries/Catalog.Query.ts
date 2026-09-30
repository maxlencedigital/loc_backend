import type { Prisma } from "@prisma/client";
import { prisma } from "../DB/Prisma.Connection.Db.js";
import {
  IPriceList,
  IPriceListCreate,
  IPriceListUpdate,
  IPriceRow,
  IPricingList,
  IService,
} from "../Models/Catalog/Catalog.Interface.js";

export type Db = Prisma.TransactionClient;

const withRowCount = { _count: { select: { rows: true } } } as const;
const withService = { service: { select: { name: true, unit: true } } } as const;

const listServices = async (db: Db = prisma): Promise<IService[]> => {
  try {
    return await db.service.findMany({ orderBy: [{ code: "asc" }] });
  } catch (error) {
    throw error;
  }
};

const findServicesByIds = async (ids: string[], db: Db = prisma): Promise<IService[]> => {
  try {
    return await db.service.findMany({ where: { id: { in: ids } } });
  } catch (error) {
    throw error;
  }
};

const listLists = async (db: Db = prisma): Promise<IPriceList[]> => {
  try {
    const lists = await db.priceList.findMany({ orderBy: [{ name: "asc" }], include: withRowCount });
    return lists.map(({ _count, ...list }) => ({ ...list, rowCount: _count.rows }));
  } catch (error) {
    throw error;
  }
};

const findListById = async (id: string, db: Db = prisma): Promise<IPriceList | null> => {
  try {
    const list = await db.priceList.findUnique({ where: { id }, include: withRowCount });
    if (!list) return null;
    const { _count, ...rest } = list;
    return { ...rest, rowCount: _count.rows };
  } catch (error) {
    throw error;
  }
};

const createList = async (data: IPriceListCreate, db: Db = prisma): Promise<IPriceList> => {
  try {
    const list = await db.priceList.create({ data });
    return { ...list, rowCount: 0 };
  } catch (error) {
    throw error;
  }
};

const updateList = async (id: string, data: IPriceListUpdate, db: Db = prisma): Promise<void> => {
  try {
    await db.priceList.update({ where: { id }, data });
  } catch (error) {
    throw error;
  }
};

const listNamesStartingWith = async (prefix: string, db: Db = prisma): Promise<string[]> => {
  try {
    const lists = await db.priceList.findMany({ where: { name: { startsWith: prefix } }, select: { name: true } });
    return lists.map((list) => list.name);
  } catch (error) {
    throw error;
  }
};

const listRows = async (priceListId: string, db: Db = prisma): Promise<IPriceRow[]> => {
  try {
    const rows = await db.priceRow.findMany({
      where: { priceListId },
      include: withService,
      orderBy: [{ service: { code: "asc" } }, { category: "asc" }, { garment: "asc" }],
    });
    return rows.map(({ service, ...row }) => ({ ...row, serviceName: service.name, unit: service.unit }));
  } catch (error) {
    throw error;
  }
};

const findRow = async (priceListId: string, rowId: string, db: Db = prisma): Promise<IPriceRow | null> => {
  try {
    const row = await db.priceRow.findFirst({ where: { id: rowId, priceListId }, include: withService });
    if (!row) return null;
    const { service, ...rest } = row;
    return { ...rest, serviceName: service.name, unit: service.unit };
  } catch (error) {
    throw error;
  }
};

// Copies every row into another list, inside the caller's transaction.
const copyRows = async (fromListId: string, toListId: string, db: Db): Promise<void> => {
  try {
    const rows = await db.priceRow.findMany({ where: { priceListId: fromListId } });
    await db.priceRow.createMany({
      data: rows.map(({ serviceId, garment, category, ratePaise, expressRatePaise }) => ({
        priceListId: toListId,
        serviceId,
        garment,
        category,
        ratePaise,
        expressRatePaise,
      })),
    });
  } catch (error) {
    throw error;
  }
};

// False when the row does not belong to that list. Also stamps the list, since the
// dashboard shows "last updated" per list, not per row.
const updateRowRates = async (
  priceListId: string,
  rowId: string,
  data: { ratePaise: number; expressRatePaise: number },
  db: Db
): Promise<boolean> => {
  try {
    const { count } = await db.priceRow.updateMany({ where: { id: rowId, priceListId }, data });
    if (count === 0) return false;
    await db.priceList.update({ where: { id: priceListId }, data: { updatedAt: new Date() } });
    return true;
  } catch (error) {
    throw error;
  }
};

// Active lists carrying only the rows for the services being ordered.
const findActiveForPricing = async (serviceIds: string[], db: Db = prisma): Promise<IPricingList[]> => {
  try {
    return await db.priceList.findMany({
      where: { active: true },
      select: {
        id: true,
        name: true,
        storeId: true,
        customerType: true,
        rows: {
          where: { serviceId: { in: serviceIds } },
          select: { serviceId: true, garment: true, category: true, ratePaise: true, expressRatePaise: true },
        },
      },
    });
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

export const CatalogQuery = {
  inTransaction,
  listServices,
  findServicesByIds,
  listLists,
  findListById,
  createList,
  updateList,
  listNamesStartingWith,
  listRows,
  findRow,
  copyRows,
  updateRowRates,
  findActiveForPricing,
};
