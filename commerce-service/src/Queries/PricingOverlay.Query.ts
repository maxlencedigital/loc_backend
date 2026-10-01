import { cacheDelByPrefix, getOrSet } from "../../commons/Cache/Cache.js";
import { prisma } from "../DB/Prisma.Connection.Db.js";
import { IPricingList } from "../Models/Catalog/Catalog.Interface.js";
import { PriceScope } from "../Models/StoreAdmin/StoreAdmin.Interface.js";

// The price hierarchy as the order pricing code sees it: each scope's overrides become a
// pricing list narrowed to the store they apply to, ranked above the plain price lists
// (global < customer-type list < area < store list < store override). Global and area tables
// are cached; every write that changes any of them calls invalidatePricing() (see
// Pricing.Service and the area writes). Store overrides are read straight from the index.

export const GLOBAL_SCOPE_ID = "00000000-0000-0000-0000-000000000000";

// Higher wins. The plain lists rank 0 (general), 10 (customer type), 20 (store), 30 (both).
export const OVERLAY_RANK: Record<PriceScope, number> = { global: 1, area: 5, store: 25 };

const CACHE_PREFIX = "pricing:";
const GLOBAL_KEY = `${CACHE_PREFIX}global`;
const AREAS_KEY = `${CACHE_PREFIX}areas`;
// A safety net only: writes invalidate at once, so this bounds how long a missed
// invalidation (Redis down during a write) could serve an old price.
const CACHE_TTL_SECONDS = 60;
const MAX_OVERRIDE_ROWS = 20_000;

type Row = IPricingList["rows"][number];
interface AreaTable {
  areaId: string;
  storeIds: string[];
  rows: Row[];
}

const rowSelect = {
  serviceId: true,
  garment: true,
  category: true,
  ratePaise: true,
  expressRatePaise: true,
} as const;

const toRow = (row: {
  serviceId: string;
  garment: string;
  category: string;
  ratePaise: number;
  expressRatePaise: number;
}): Row => ({ ...row, category: row.category as Row["category"] });

const loadGlobal = (): Promise<Row[]> =>
  getOrSet(GLOBAL_KEY, CACHE_TTL_SECONDS, async () => {
    const rows = await prisma.priceOverride.findMany({
      where: { scope: "global" },
      select: rowSelect,
      take: MAX_OVERRIDE_ROWS,
    });
    return rows.map(toRow);
  });

const loadAreas = (): Promise<AreaTable[]> =>
  getOrSet(AREAS_KEY, CACHE_TTL_SECONDS, async () => {
    const rows = await prisma.priceOverride.findMany({
      where: { scope: "area" },
      select: { scopeId: true, ...rowSelect },
      take: MAX_OVERRIDE_ROWS,
    });
    if (rows.length === 0) return [];
    const areaIds = [...new Set(rows.map((r) => r.scopeId))];
    const members = await prisma.storeAreaMember.findMany({
      where: { areaId: { in: areaIds } },
      select: { areaId: true, storeId: true },
    });
    return areaIds.map((areaId) => ({
      areaId,
      storeIds: members.filter((m) => m.areaId === areaId).map((m) => m.storeId),
      rows: rows.filter((r) => r.scopeId === areaId).map(toRow),
    }));
  });

const only = (rows: Row[], serviceIds: Set<string>): Row[] => rows.filter((row) => serviceIds.has(row.serviceId));

const overlayList = (id: string, name: string, scope: PriceScope, storeId: string | null, rows: Row[]): IPricingList => ({
  id,
  name,
  storeId,
  customerType: null,
  rows,
  rank: OVERLAY_RANK[scope],
  overlay: true,
  source: scope,
});

/** The override lists for these services: global, one per area store, one per store with overrides. */
const overlayLists = async (serviceIds: string[]): Promise<IPricingList[]> => {
  try {
    const wanted = new Set(serviceIds);
    const [globalRows, areas, storeRows] = await Promise.all([
      loadGlobal(),
      loadAreas(),
      prisma.priceOverride.findMany({
        where: { scope: "store", serviceId: { in: serviceIds } },
        select: { scopeId: true, ...rowSelect },
        take: MAX_OVERRIDE_ROWS,
      }),
    ]);

    const lists: IPricingList[] = [];
    const global = only(globalRows, wanted);
    if (global.length > 0) lists.push(overlayList("overlay:global", "Global prices", "global", null, global));
    for (const area of areas) {
      const rows = only(area.rows, wanted);
      if (rows.length === 0) continue;
      for (const storeId of area.storeIds) {
        lists.push(overlayList(`overlay:area:${area.areaId}:${storeId}`, "Area prices", "area", storeId, rows));
      }
    }
    const byStore = new Map<string, Row[]>();
    for (const row of storeRows) byStore.set(row.scopeId, [...(byStore.get(row.scopeId) ?? []), toRow(row)]);
    for (const [storeId, rows] of byStore) {
      lists.push(overlayList(`overlay:store:${storeId}`, "Store prices", "store", storeId, rows));
    }
    return lists;
  } catch (error) {
    throw error;
  }
};

/** Drops every cached price table. Called after any write that changes a price or an area's stores. */
const invalidatePricing = async (): Promise<void> => cacheDelByPrefix(CACHE_PREFIX);

export const PricingOverlayQuery = { overlayLists, invalidatePricing };
