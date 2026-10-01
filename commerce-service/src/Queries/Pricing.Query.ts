import type { Prisma } from "@prisma/client";
import { Page, PageRequest, toPage } from "../../commons/Utils/Pagination.js";
import { prisma } from "../DB/Prisma.Connection.Db.js";
import {
  IGarmentTypeRef,
  IPriceChange,
  IPriceChangeWrite,
  IPriceOverride,
  IPriceOverrideWrite,
  PriceScope,
} from "../Models/StoreAdmin/StoreAdmin.Interface.js";
import { garmentTypeIdOf } from "../Utils/GarmentTypeId.js";

export type Db = Prisma.TransactionClient;

const PRICING_LOCK = "pricing_write";
const MAX_ROWS = 5_000;

const toOverride = (row: Prisma.PriceOverrideGetPayload<object>): IPriceOverride => ({
  id: row.id,
  scope: row.scope as PriceScope,
  scopeId: row.scopeId,
  serviceId: row.serviceId,
  garmentTypeId: row.garmentTypeId,
  garment: row.garment,
  category: row.category,
  ratePaise: row.ratePaise,
  expressRatePaise: row.expressRatePaise,
  updatedAt: row.updatedAt,
});

const inTransaction = async <T>(work: (tx: Db) => Promise<T>): Promise<T> => {
  try {
    return await prisma.$transaction(work);
  } catch (error) {
    throw error;
  }
};

// Every pricing write takes this one counter row's lock first (an atomic UPDATE held until the
// transaction ends), so two admins can never interleave their old/new history.
const lockPricing = async (db: Db): Promise<void> => {
  try {
    await db.sequenceCounter.update({ where: { name: PRICING_LOCK }, data: { value: { increment: 1 } } });
  } catch (error) {
    throw error;
  }
};

const listOverrides = async (scope: PriceScope, scopeId: string, db: Db = prisma): Promise<IPriceOverride[]> => {
  try {
    const rows = await db.priceOverride.findMany({
      where: { scope, scopeId },
      orderBy: [{ garment: "asc" }, { category: "asc" }, { id: "asc" }],
      take: MAX_ROWS,
    });
    return rows.map(toOverride);
  } catch (error) {
    throw error;
  }
};

const findOverride = async (scope: PriceScope, scopeId: string, id: string, db: Db = prisma): Promise<IPriceOverride | null> => {
  try {
    const row = await db.priceOverride.findFirst({ where: { id, scope, scopeId } });
    return row ? toOverride(row) : null;
  } catch (error) {
    throw error;
  }
};

const deleteOverrides = async (ids: string[], db: Db): Promise<void> => {
  try {
    if (ids.length > 0) await db.priceOverride.deleteMany({ where: { id: { in: ids } } });
  } catch (error) {
    throw error;
  }
};

const createOverrides = async (
  scope: PriceScope,
  scopeId: string,
  rows: IPriceOverrideWrite[],
  byName: string,
  db: Db
): Promise<void> => {
  try {
    if (rows.length > 0) {
      await db.priceOverride.createMany({ data: rows.map((row) => ({ ...row, scope, scopeId, updatedByName: byName })) });
    }
  } catch (error) {
    throw error;
  }
};

const createHistory = async (changes: IPriceChangeWrite[], db: Db): Promise<void> => {
  try {
    if (changes.length > 0) await db.priceChange.createMany({ data: changes });
  } catch (error) {
    throw error;
  }
};

export interface IHistoryFilter {
  // Each entry is one (scope, scopeId) pair whose changes are wanted; null means no scope filter.
  scopes: { scope: PriceScope; scopeId: string }[] | null;
  start?: Date;
  end?: Date;
}

const listHistory = async (filter: IHistoryFilter, page: PageRequest): Promise<Page<IPriceChange>> => {
  try {
    const where: Prisma.PriceChangeWhereInput = {
      ...(filter.scopes ? { OR: filter.scopes } : {}),
      ...(filter.start || filter.end ? { at: { gte: filter.start, lt: filter.end } } : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.priceChange.findMany({ where, orderBy: [{ at: "desc" }, { id: "desc" }], skip: page.offset, take: page.limit }),
      prisma.priceChange.count({ where }),
    ]);
    return toPage(rows.map((row) => ({ ...row, scope: row.scope as PriceScope })), total, page);
  } catch (error) {
    throw error;
  }
};

// Garment types are the distinct (garment, category) pairs the price lists already carry; the
// id is derived from the pair, so there is nothing else to store.
const listGarmentTypes = async (db: Db = prisma): Promise<IGarmentTypeRef[]> => {
  try {
    const rows = await db.priceRow.findMany({
      distinct: ["garment", "category"],
      select: { garment: true, category: true },
      orderBy: [{ garment: "asc" }, { category: "asc" }],
      take: MAX_ROWS,
    });
    const seen = new Map<string, IGarmentTypeRef>();
    for (const row of rows) {
      const garmentTypeId = garmentTypeIdOf(row.category, row.garment);
      if (!seen.has(garmentTypeId)) seen.set(garmentTypeId, { garmentTypeId, garment: row.garment, category: row.category });
    }
    return [...seen.values()];
  } catch (error) {
    throw error;
  }
};

/** Rows of the active general price lists (no store, no customer type): the global fallback. */
const listGeneralListRows = async (db: Db = prisma) => {
  try {
    const rows = await db.priceRow.findMany({
      where: { priceList: { active: true, storeId: null, customerType: null } },
      select: {
        serviceId: true,
        garment: true,
        category: true,
        ratePaise: true,
        expressRatePaise: true,
        service: { select: { name: true } },
        priceList: { select: { name: true } },
      },
      orderBy: [{ priceList: { name: "asc" } }, { garment: "asc" }, { id: "asc" }],
      take: MAX_ROWS,
    });
    return rows.map(({ service, priceList, ...row }) => ({ ...row, serviceName: service.name, listName: priceList.name }));
  } catch (error) {
    throw error;
  }
};

const areaIdOfStore = async (storeId: string, db: Db = prisma): Promise<string | null> => {
  try {
    const row = await db.storeAreaMember.findUnique({ where: { storeId }, select: { areaId: true } });
    return row ? row.areaId : null;
  } catch (error) {
    throw error;
  }
};

const latestUpdate = async (scope: PriceScope, scopeId: string, db: Db = prisma): Promise<Date | null> => {
  try {
    const result = await db.priceOverride.aggregate({ where: { scope, scopeId }, _max: { updatedAt: true } });
    return result._max.updatedAt;
  } catch (error) {
    throw error;
  }
};

export const PricingQuery = {
  inTransaction,
  lockPricing,
  listOverrides,
  findOverride,
  deleteOverrides,
  createOverrides,
  createHistory,
  listHistory,
  listGarmentTypes,
  listGeneralListRows,
  areaIdOfStore,
  latestUpdate,
};
