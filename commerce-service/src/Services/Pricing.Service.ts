import { CustomException } from "../../commons/Exception/CustomException.js";
import { toCustomException } from "../../commons/Exception/ToCustomException.js";
import { parsePage } from "../../commons/Utils/Pagination.js";
import { badRequest, notFound } from "../../commons/Utils/StatusCode.js";
import type { RequestUser } from "../Middleware/Identity.js";
import type { StoreScope } from "../Middleware/StoreScope.js";
import {
  IGarmentTypeRef,
  IPriceChangeWrite,
  IPriceOverride,
  IPriceOverrideWrite,
  PriceScope,
} from "../Models/StoreAdmin/StoreAdmin.Interface.js";
import { CatalogQuery } from "../Queries/Catalog.Query.js";
import { GLOBAL_SCOPE_ID, PricingOverlayQuery } from "../Queries/PricingOverlay.Query.js";
import { PricingQuery } from "../Queries/Pricing.Query.js";
import { StoreAdminQuery } from "../Queries/StoreAdmin.Query.js";
import { parseBody, queryString } from "../Utils/Input.js";
import { rupeesToPaise, toRupees } from "../Utils/Money.js";
import { garmentTypeIdOf } from "../Utils/GarmentTypeId.js";
import { istDayStart, istNextDayStart, parseBusinessDate, todayIst } from "../Utils/StoreAdminInput.js";
import { isUuid } from "../Utils/Uuid.js";
import { actorNameOf, requireStore } from "./StoreAccess.js";
import { exactMatch, rankLists } from "./OrderPricing.js";

// ₹1,00,000 for one unit is far past any laundry rate; it only stops a typo (same bound as price lists).
const MAX_RATE_PAISE = 10_000_000;
const MAX_GLOBAL_ITEMS = 2_000;
const MAX_SCOPED_ITEMS = 500;
// The catalogue gives only one price per item. When an express price is not sent it is the
// standard price plus this uplift, which is the ratio the seeded price lists already use.
export const EXPRESS_UPLIFT_PERCENT = 145;

const AREA_NOT_FOUND = "Area not found.";
const OVERRIDE_NOT_FOUND = "Price override not found.";

const toOverrideView = (row: IPriceOverride) => ({
  id: row.id,
  serviceId: row.serviceId,
  garmentTypeId: row.garmentTypeId,
  garment: row.garment,
  category: row.category,
  price: toRupees(row.ratePaise),
  expressPrice: toRupees(row.expressRatePaise),
});

const itemKey = (serviceId: string, garmentTypeId: string) => `${serviceId}|${garmentTypeId}`;

// serviceId, garmentTypeId and price per item, each checked against what really exists, so a
// price can only be set for a service and garment the shop actually sells.
const parseItems = async (raw: unknown, field: string, max: number): Promise<IPriceOverrideWrite[]> => {
  if (!Array.isArray(raw)) throw new CustomException(`${field} must be a list.`, badRequest);
  if (raw.length > max) throw new CustomException(`${field} can have at most ${max} entries.`, badRequest);

  const parsed = raw.map((entry, index) => {
    const label = `${field}[${index + 1}]`;
    const item = parseBody(entry);
    if (!isUuid(item.serviceId)) throw new CustomException(`${label}: serviceId is not valid.`, badRequest);
    if (!isUuid(item.garmentTypeId)) throw new CustomException(`${label}: garmentTypeId is not valid.`, badRequest);
    const ratePaise = rupeesToPaise(item.price, `${label}: price`, MAX_RATE_PAISE);
    const expressRatePaise =
      item.expressPrice === undefined || item.expressPrice === null
        ? Math.round((ratePaise * EXPRESS_UPLIFT_PERCENT) / 100)
        : rupeesToPaise(item.expressPrice, `${label}: expressPrice`, MAX_RATE_PAISE);
    if (expressRatePaise < ratePaise) throw new CustomException(`${label}: expressPrice cannot be lower than price.`, badRequest);
    return { serviceId: item.serviceId, garmentTypeId: item.garmentTypeId, ratePaise, expressRatePaise };
  });

  const seen = new Set<string>();
  for (const item of parsed) {
    const key = itemKey(item.serviceId, item.garmentTypeId);
    if (seen.has(key)) throw new CustomException(`${field} lists the same service and garment twice.`, badRequest);
    seen.add(key);
  }
  if (parsed.length === 0) return [];

  const [services, types] = await Promise.all([
    CatalogQuery.findServicesByIds([...new Set(parsed.map((p) => p.serviceId))]),
    PricingQuery.listGarmentTypes(),
  ]);
  const knownServices = new Set(services.map((s) => s.id));
  const knownTypes = new Map<string, IGarmentTypeRef>(types.map((t) => [t.garmentTypeId, t]));
  return parsed.map((item, index) => {
    const type = knownTypes.get(item.garmentTypeId);
    if (!knownServices.has(item.serviceId)) throw new CustomException(`${field}[${index + 1}]: unknown service.`, badRequest);
    if (!type) throw new CustomException(`${field}[${index + 1}]: unknown garment type.`, badRequest);
    return { ...item, garment: type.garment, category: type.category };
  });
};

// Makes a scope's overrides exactly `items`: unchanged rows are left alone, a changed price is
// replaced, a missing one removed, and each of those is written to the history with who and
// when. One transaction under the pricing lock, so the history is never interleaved or partial.
const replaceOverrides = async (
  scope: PriceScope,
  scopeId: string,
  items: IPriceOverrideWrite[],
  user: RequestUser
): Promise<IPriceOverride[]> => {
  const byName = actorNameOf(user);
  const result = await PricingQuery.inTransaction(async (tx) => {
    await PricingQuery.lockPricing(tx);
    const existing = await PricingQuery.listOverrides(scope, scopeId, tx);
    const current = new Map(existing.map((row) => [itemKey(row.serviceId, row.garmentTypeId), row]));
    const wanted = new Map(items.map((item) => [itemKey(item.serviceId, item.garmentTypeId), item]));

    const changes: IPriceChangeWrite[] = [];
    const remove: string[] = [];
    const add: IPriceOverrideWrite[] = [];
    const change = (item: { serviceId: string; garmentTypeId: string }, fromPaise: number | null, toPaise: number | null) =>
      changes.push({ scope, scopeId, serviceId: item.serviceId, garmentTypeId: item.garmentTypeId, fromPaise, toPaise, byUserId: user.id, byName });

    for (const [key, row] of current) {
      const next = wanted.get(key);
      if (!next) {
        remove.push(row.id);
        change(row, row.ratePaise, null);
      } else if (next.ratePaise !== row.ratePaise || next.expressRatePaise !== row.expressRatePaise) {
        remove.push(row.id);
        add.push(next);
        change(row, row.ratePaise, next.ratePaise);
      }
    }
    for (const [key, item] of wanted) {
      if (!current.has(key)) {
        add.push(item);
        change(item, null, item.ratePaise);
      }
    }

    await PricingQuery.deleteOverrides(remove, tx);
    await PricingQuery.createOverrides(scope, scopeId, add, byName, tx);
    await PricingQuery.createHistory(changes, tx);
    return await PricingQuery.listOverrides(scope, scopeId, tx);
  });
  await PricingOverlayQuery.invalidatePricing();
  return result;
};

// A store-bound manager reaches only the area their store is in; anyone else any area.
const requireArea = async (id: string, scope: StoreScope, user: RequestUser) => {
  const onlyStore = user.role === "manager" ? scope : null;
  const area = isUuid(id) ? await StoreAdminQuery.findArea(id, onlyStore) : null;
  if (!area) throw new CustomException(AREA_NOT_FOUND, notFound);
  return area;
};

const getAreaPricing = async (scope: StoreScope, user: RequestUser, areaId: string) => {
  try {
    const area = await requireArea(areaId, scope, user);
    return { overrides: (await PricingQuery.listOverrides("area", area.id)).map(toOverrideView) };
  } catch (error) {
    throw toCustomException(error);
  }
};

const setAreaPricing = async (scope: StoreScope, user: RequestUser, areaId: string, input: unknown) => {
  try {
    const body = parseBody(input);
    const items = await parseItems(body.overrides, "overrides", MAX_SCOPED_ITEMS);
    const area = await requireArea(areaId, scope, user);
    return { overrides: (await replaceOverrides("area", area.id, items, user)).map(toOverrideView) };
  } catch (error) {
    throw toCustomException(error);
  }
};

const getStorePricing = async (scope: StoreScope, storeId: string) => {
  try {
    await requireStore(storeId, scope);
    return { overrides: (await PricingQuery.listOverrides("store", storeId)).map(toOverrideView) };
  } catch (error) {
    throw toCustomException(error);
  }
};

const setStorePricing = async (scope: StoreScope, user: RequestUser, storeId: string, input: unknown) => {
  try {
    const body = parseBody(input);
    const items = await parseItems(body.overrides, "overrides", MAX_SCOPED_ITEMS);
    await requireStore(storeId, scope);
    return { overrides: (await replaceOverrides("store", storeId, items, user)).map(toOverrideView) };
  } catch (error) {
    throw toCustomException(error);
  }
};

const removeStorePriceOverride = async (scope: StoreScope, user: RequestUser, storeId: string, overrideId: string) => {
  try {
    await requireStore(storeId, scope);
    const byName = actorNameOf(user);
    const removed = await PricingQuery.inTransaction(async (tx) => {
      await PricingQuery.lockPricing(tx);
      const row = isUuid(overrideId) ? await PricingQuery.findOverride("store", storeId, overrideId, tx) : null;
      if (!row) throw new CustomException(OVERRIDE_NOT_FOUND, notFound);
      await PricingQuery.deleteOverrides([row.id], tx);
      await PricingQuery.createHistory(
        [{ scope: "store", scopeId: storeId, serviceId: row.serviceId, garmentTypeId: row.garmentTypeId, fromPaise: row.ratePaise, toPaise: null, byUserId: user.id, byName }],
        tx
      );
      return row;
    });
    await PricingOverlayQuery.invalidatePricing();
    return { id: removed.id, removed: true };
  } catch (error) {
    throw toCustomException(error);
  }
};

const istDateOf = (at: Date | null): string | null => (at ? todayIst(at) : null);

// The global view: the global overrides, and under them whatever the general price lists price
// that the overrides do not. `source` says which of the two an item comes from.
const getGlobalPricing = async () => {
  try {
    const [overrides, listRows, updatedAt] = await Promise.all([
      PricingQuery.listOverrides("global", GLOBAL_SCOPE_ID),
      PricingQuery.listGeneralListRows(),
      PricingQuery.latestUpdate("global", GLOBAL_SCOPE_ID),
    ]);
    const items: (ReturnType<typeof toOverrideView> & { source: "global" | "price_list" })[] = overrides.map((row) => ({
      ...toOverrideView(row),
      source: "global",
    }));
    const taken = new Set(overrides.map((row) => itemKey(row.serviceId, row.garmentTypeId)));
    for (const row of listRows) {
      const garmentTypeId = garmentTypeIdOf(row.category, row.garment);
      const key = itemKey(row.serviceId, garmentTypeId);
      if (taken.has(key)) continue;
      taken.add(key);
      items.push({
        id: `${row.listName}:${key}`,
        serviceId: row.serviceId,
        garmentTypeId,
        garment: row.garment,
        category: row.category,
        price: toRupees(row.ratePaise),
        expressPrice: toRupees(row.expressRatePaise),
        source: "price_list",
      });
    }
    return { items, effectiveFrom: istDateOf(updatedAt) };
  } catch (error) {
    throw toCustomException(error);
  }
};

const setGlobalPricing = async (user: RequestUser, input: unknown, now = new Date()) => {
  try {
    const body = parseBody(input);
    if (body.effectiveFrom !== undefined && body.effectiveFrom !== null) {
      const from = parseBusinessDate(body.effectiveFrom, "effectiveFrom");
      if (from > todayIst(now)) {
        throw new CustomException("Prices that start on a later date are not supported: leave effectiveFrom out or use today.", badRequest);
      }
    }
    const items = await parseItems(body.items, "items", MAX_GLOBAL_ITEMS);
    const saved = await replaceOverrides("global", GLOBAL_SCOPE_ID, items, user);
    return { items: saved.map(toOverrideView), effectiveFrom: todayIst(now) };
  } catch (error) {
    throw toCustomException(error);
  }
};

// The price an order would use for a retail customer of this store: the same ranked lists the
// order code builds, so what an admin sees here is what a booking charges.
const getEffectivePrice = async (scope: StoreScope, query: Record<string, unknown>) => {
  try {
    const storeId = queryString(query.storeId, "storeId");
    const serviceId = queryString(query.serviceId, "serviceId");
    const garmentTypeId = queryString(query.garmentTypeId, "garmentTypeId");
    if (!isUuid(storeId) || !isUuid(serviceId) || !isUuid(garmentTypeId)) {
      throw new CustomException("storeId, serviceId and garmentTypeId must be valid ids.", badRequest);
    }
    await requireStore(storeId, scope);
    const [services, types] = await Promise.all([CatalogQuery.findServicesByIds([serviceId]), PricingQuery.listGarmentTypes()]);
    const type = types.find((t) => t.garmentTypeId === garmentTypeId);
    if (services.length === 0) throw new CustomException("serviceId does not match a service.", badRequest);
    if (!type) throw new CustomException("garmentTypeId does not match a garment type.", badRequest);

    const lists = rankLists(await CatalogQuery.findActiveForPricing([serviceId]), storeId, "retail");
    const match = exactMatch(lists, serviceId, type.garment, type.category);
    if (!match) throw new CustomException("No price is set for this service and garment at this store.", notFound);
    return {
      price: toRupees(match.row.ratePaise),
      expressPrice: toRupees(match.row.expressRatePaise),
      source: match.list.source ?? "global",
    };
  } catch (error) {
    throw toCustomException(error);
  }
};

const parseHistoryDate = (value: unknown, field: string): string | undefined => {
  const raw = queryString(value, field);
  return raw === undefined ? undefined : parseBusinessDate(raw, field);
};

const getPricingHistory = async (query: Record<string, unknown>) => {
  try {
    const page = parsePage(query);
    const storeId = queryString(query.storeId, "storeId");
    if (storeId !== undefined && !isUuid(storeId)) throw new CustomException("storeId must be a valid id.", badRequest);
    const from = parseHistoryDate(query.from, "from");
    const to = parseHistoryDate(query.to, "to");
    if (from && to && from > to) throw new CustomException("from cannot be after to.", badRequest);

    // For one store: its own changes, its area's and the global ones: everything that moved its prices.
    let scopes: { scope: PriceScope; scopeId: string }[] | null = null;
    if (storeId) {
      const areaId = await PricingQuery.areaIdOfStore(storeId);
      scopes = [
        { scope: "store", scopeId: storeId },
        { scope: "global", scopeId: GLOBAL_SCOPE_ID },
        ...(areaId ? [{ scope: "area" as const, scopeId: areaId }] : []),
      ];
    }
    const result = await PricingQuery.listHistory(
      { scopes, start: from ? istDayStart(from) : undefined, end: to ? istNextDayStart(to) : undefined },
      page
    );
    return {
      changes: result.items.map((c) => ({
        at: c.at.toISOString(),
        by: c.byName,
        scope: c.scope,
        scopeId: c.scopeId === GLOBAL_SCOPE_ID ? null : c.scopeId,
        serviceId: c.serviceId,
        garmentTypeId: c.garmentTypeId,
        from: c.fromPaise === null ? null : toRupees(c.fromPaise),
        to: c.toPaise === null ? null : toRupees(c.toPaise),
      })),
      page: result.page,
      limit: result.limit,
      total: result.total,
    };
  } catch (error) {
    throw toCustomException(error);
  }
};

export const PricingService = {
  getAreaPricing,
  setAreaPricing,
  getStorePricing,
  setStorePricing,
  removeStorePriceOverride,
  getGlobalPricing,
  setGlobalPricing,
  getEffectivePrice,
  getPricingHistory,
};
