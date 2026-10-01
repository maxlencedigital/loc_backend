import { CustomException } from "../../commons/Exception/CustomException.js";
import { toCustomException } from "../../commons/Exception/ToCustomException.js";
import { parsePage } from "../../commons/Utils/Pagination.js";
import { badRequest, conflict, notFound } from "../../commons/Utils/StatusCode.js";
import type { RequestUser } from "../Middleware/Identity.js";
import type { StoreScope } from "../Middleware/StoreScope.js";
import type { IArea } from "../Models/StoreAdmin/StoreAdmin.Interface.js";
import { OrderStatus } from "../Models/Order/OrderStatus.js";
import { CustomerQuery } from "../Queries/Customer.Query.js";
import { isUniqueViolation } from "../Queries/DatabaseError.js";
import { OrderQuery } from "../Queries/Order.Query.js";
import { PricingOverlayQuery } from "../Queries/PricingOverlay.Query.js";
import { StoreAdminQuery } from "../Queries/StoreAdmin.Query.js";
import { StoreCashQuery } from "../Queries/StoreCash.Query.js";
import { StoreSignalsQuery } from "../Queries/StoreSignals.Query.js";
import { optionalText, parseBody, text } from "../Utils/Input.js";
import { toRupees } from "../Utils/Money.js";
import { parseDateRange, queryList, todayIst } from "../Utils/StoreAdminInput.js";
import { isUuid } from "../Utils/Uuid.js";
import { percent } from "./StoreDayOps.Service.js";
import { requireStore, STORE_NOT_FOUND } from "./StoreAccess.js";

const AREA_NOT_FOUND = "Area not found.";
const PINCODE = /^[1-9][0-9]{5}$/;
const MAX_PINCODES = 200;
const MAX_AREA_STORES = 50;
const MAX_COMPARE_IDS = 20;
// Where a store's orders queue up while being processed, in plant order.
const PROCESSING_STAGES: OrderStatus[] = ["sorted", "washing", "drying", "quality_check", "packed"];

const toAreaView = (area: IArea) => ({
  id: area.id,
  name: area.name,
  city: area.city,
  pincodes: area.pincodes,
  storeIds: area.storeIds,
  createdAt: area.createdAt.toISOString(),
  updatedAt: area.updatedAt.toISOString(),
});

// A store-bound manager sees the area their store is in, and only their own store inside it.
const onlyStoreFor = (user: RequestUser, scope: StoreScope): string | null => (user.role === "manager" ? scope : null);

const parsePincodes = (value: unknown): string[] => {
  if (!Array.isArray(value)) throw new CustomException("pincodes must be a list.", badRequest);
  if (value.length > MAX_PINCODES) throw new CustomException(`An area can have at most ${MAX_PINCODES} pincodes.`, badRequest);
  const codes = value.map((code) => {
    if (typeof code !== "string" || !PINCODE.test(code.trim())) {
      throw new CustomException("Each pincode must be 6 digits.", badRequest);
    }
    return code.trim();
  });
  return [...new Set(codes)];
};

const parseStoreIds = async (value: unknown): Promise<string[]> => {
  if (!Array.isArray(value)) throw new CustomException("storeIds must be a list.", badRequest);
  if (value.length > MAX_AREA_STORES) throw new CustomException(`An area can have at most ${MAX_AREA_STORES} stores.`, badRequest);
  if (!value.every(isUuid)) throw new CustomException("storeIds must be valid ids.", badRequest);
  const ids = [...new Set(value as string[])];
  if (ids.length === 0) return ids;
  const found = new Set(await StoreAdminQuery.existingStoreIds(ids));
  if (ids.some((id) => !found.has(id))) throw new CustomException("storeIds must all be existing stores.", badRequest);
  return ids;
};

const duplicate = (error: unknown): unknown => {
  if (isUniqueViolation(error, "store_area_name")) return new CustomException("An area with this name already exists.", conflict);
  if (isUniqueViolation(error, "area_member")) {
    return new CustomException("One of those stores is already in another area.", conflict);
  }
  return error;
};

const listAreas = async (scope: StoreScope, user: RequestUser, query: Record<string, unknown>) => {
  try {
    const result = await StoreAdminQuery.listAreas(onlyStoreFor(user, scope), parsePage(query));
    return { ...result, items: result.items.map(toAreaView) };
  } catch (error) {
    throw toCustomException(error);
  }
};

const getArea = async (scope: StoreScope, user: RequestUser, id: string) => {
  try {
    const area = isUuid(id) ? await StoreAdminQuery.findArea(id, onlyStoreFor(user, scope)) : null;
    if (!area) throw new CustomException(AREA_NOT_FOUND, notFound);
    return toAreaView(area);
  } catch (error) {
    throw toCustomException(error);
  }
};

const createArea = async (input: unknown) => {
  try {
    const body = parseBody(input);
    const data = {
      name: text(body.name, "name", 80),
      city: optionalText(body.city, "city", 60) ?? "",
      pincodes: body.pincodes === undefined ? [] : parsePincodes(body.pincodes),
    };
    const storeIds = body.storeIds === undefined ? [] : await parseStoreIds(body.storeIds);
    try {
      const id = await StoreAdminQuery.inTransaction(async (tx) => {
        const created = await StoreAdminQuery.createArea(data, tx);
        await StoreAdminQuery.setMembers(created, storeIds, tx);
        return created;
      });
      if (storeIds.length > 0) await PricingOverlayQuery.invalidatePricing();
      return toAreaView((await StoreAdminQuery.findArea(id, null)) as IArea);
    } catch (error) {
      throw duplicate(error);
    }
  } catch (error) {
    throw toCustomException(error);
  }
};

const updateArea = async (id: string, input: unknown) => {
  try {
    const body = parseBody(input);
    const data: { name?: string; city?: string; pincodes?: string[] } = {};
    if (body.name !== undefined) data.name = text(body.name, "name", 80);
    if (body.city !== undefined) data.city = text(body.city, "city", 60);
    if (body.pincodes !== undefined) data.pincodes = parsePincodes(body.pincodes);
    const storeIds = body.storeIds === undefined ? undefined : await parseStoreIds(body.storeIds);
    if (!isUuid(id) || !(await StoreAdminQuery.findArea(id, null))) throw new CustomException(AREA_NOT_FOUND, notFound);

    try {
      await StoreAdminQuery.inTransaction(async (tx) => {
        if (Object.keys(data).length > 0) await StoreAdminQuery.updateArea(id, data, tx);
        if (storeIds) await StoreAdminQuery.setMembers(id, storeIds, tx);
      });
    } catch (error) {
      throw duplicate(error);
    }
    if (storeIds) await PricingOverlayQuery.invalidatePricing();
    return toAreaView((await StoreAdminQuery.findArea(id, null)) as IArea);
  } catch (error) {
    throw toCustomException(error);
  }
};

// An area with stores in it cannot go: its stores would silently lose the area's prices.
const deleteArea = async (id: string) => {
  try {
    if (!isUuid(id) || !(await StoreAdminQuery.findArea(id, null))) throw new CustomException(AREA_NOT_FOUND, notFound);
    await StoreAdminQuery.inTransaction(async (tx) => {
      if ((await StoreAdminQuery.countMembers(id, tx)) > 0) {
        throw new CustomException("Move this area's stores to another area before deleting it.", conflict);
      }
      await StoreAdminQuery.deleteArea(id, tx);
    });
    await PricingOverlayQuery.invalidatePricing();
    return { id, deleted: true };
  } catch (error) {
    throw toCustomException(error);
  }
};

const getCustomerStoreActivity = async (scope: StoreScope, user: RequestUser, customerId: string) => {
  try {
    const onlyStore = onlyStoreFor(user, scope);
    const customer = isUuid(customerId) ? await CustomerQuery.findById(customerId, onlyStore) : null;
    if (!customer) throw new CustomException("Customer not found.", notFound);
    const rows = await StoreAdminQuery.ordersByStore(customer.id, onlyStore);
    const names = await StoreAdminQuery.storeNames(rows.map((r) => r.storeId));
    return {
      stores: rows.map((row) => ({
        storeId: row.storeId,
        name: names.get(row.storeId)?.name ?? "",
        orders: row.orders,
        lastOrderAt: row.lastOrderAt ? row.lastOrderAt.toISOString() : null,
        spend: toRupees(row.spendPaise),
      })),
    };
  } catch (error) {
    throw toCustomException(error);
  }
};

// Which stores to compare: the ones asked for, else every store; a store-bound caller can
// only ever compare their own store, and asking for another one is a 404.
const compareTargets = async (scope: StoreScope, query: Record<string, unknown>) => {
  const ids = queryList(query.ids, "ids", MAX_COMPARE_IDS);
  if (ids && !ids.every(isUuid)) throw new CustomException("ids must be valid ids.", badRequest);
  if (scope) {
    if (ids && ids.some((id) => id !== scope)) throw new CustomException(STORE_NOT_FOUND, notFound);
    return (await StoreAdminQuery.storeNames([scope])).has(scope) ? [{ id: scope }] : [];
  }
  if (ids) {
    const found = new Set(await StoreAdminQuery.existingStoreIds(ids));
    if (ids.some((id) => !found.has(id))) throw new CustomException(STORE_NOT_FOUND, notFound);
    return ids.map((id) => ({ id }));
  }
  return await StoreAdminQuery.listStoresForCompare();
};

const compareStores = async (scope: StoreScope, query: Record<string, unknown>, now = new Date()) => {
  try {
    const range = parseDateRange(query, now);
    const targets = await compareTargets(scope, query);
    const storeIds = targets.map((t) => t.id);
    if (storeIds.length === 0) return { from: range.from, to: range.to, stores: [] };

    const [metrics, complaints, names] = await Promise.all([
      StoreSignalsQuery.metricsFor(storeIds, range.start, range.end),
      StoreSignalsQuery.complaintsRaised(storeIds, range.start, range.end),
      StoreAdminQuery.storeNames(storeIds),
    ]);
    return {
      from: range.from,
      to: range.to,
      stores: metrics.map((m) => ({
        storeId: m.storeId,
        name: names.get(m.storeId)?.name ?? "",
        code: names.get(m.storeId)?.code ?? "",
        revenue: toRupees(m.revenuePaise),
        orders: m.orders,
        onTimePct: percent(m.onTime, m.delivered),
        complaints: complaints.get(m.storeId) ?? 0,
      })),
    };
  } catch (error) {
    throw toCustomException(error);
  }
};

// The processing stage with the most orders waiting in it right now.
const bottleneckOf = (counts: Partial<Record<OrderStatus, number>>): string => {
  let best: OrderStatus | null = null;
  for (const stage of PROCESSING_STAGES) {
    if ((counts[stage] ?? 0) > (best ? counts[best] ?? 0 : 0)) best = stage;
  }
  return best ?? "none";
};

const getStoreOverview = async (scope: StoreScope, storeId: string, query: Record<string, unknown>, now = new Date()) => {
  try {
    const range = parseDateRange(query, now);
    await requireStore(storeId, scope);
    const [[metrics], complaints, staffOnShift, cashVariance, stages] = await Promise.all([
      StoreSignalsQuery.metricsFor([storeId], range.start, range.end),
      StoreSignalsQuery.openComplaints([storeId]),
      StoreSignalsQuery.countOnShift(storeId, todayIst(now)),
      StoreCashQuery.sumUnresolvedVariance(storeId, range.from, range.to),
      OrderQuery.countByStatus(storeId, PROCESSING_STAGES),
    ]);
    return {
      from: range.from,
      to: range.to,
      revenue: toRupees(metrics?.revenuePaise ?? 0),
      orders: metrics?.orders ?? 0,
      onTimePct: percent(metrics?.onTime ?? 0, metrics?.delivered ?? 0),
      capacityBottleneck: bottleneckOf(stages),
      complaintsOpen: complaints.get(storeId) ?? 0,
      staffOnShift,
      cashVariance: toRupees(cashVariance),
    };
  } catch (error) {
    throw toCustomException(error);
  }
};

export const AdminStoresService = {
  listAreas,
  getArea,
  createArea,
  updateArea,
  deleteArea,
  getCustomerStoreActivity,
  compareStores,
  getStoreOverview,
};
