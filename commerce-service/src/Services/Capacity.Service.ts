import { CustomException } from "../../commons/Exception/CustomException.js";
import { toCustomException } from "../../commons/Exception/ToCustomException.js";
import { badRequest, notFound } from "../../commons/Utils/StatusCode.js";
import type { StoreScope } from "../Middleware/StoreScope.js";
import { ORDER_STATUS_FLOW, ORDER_STATUS_LABEL, type OrderStatus } from "../Models/Order/OrderStatus.js";
import type { ICapacitySetting, IDayLoad, IMachineAggregate, MachineType } from "../Models/StoreFloor/StoreFloor.Interface.js";
import type { IStore } from "../Models/Store/Store.Interface.js";
import { CapacityQuery } from "../Queries/Capacity.Query.js";
import { StoreQuery } from "../Queries/Store.Query.js";
import { queryString } from "../Utils/Input.js";
import { STORE_NOT_FOUND, localDate, resolveStoreFilter } from "./FloorSupport.js";

// Orders still in the plant: everything up to and including packed. Out for delivery is the rider's.
const IN_PLANT: OrderStatus[] = ORDER_STATUS_FLOW.slice(0, ORDER_STATUS_FLOW.indexOf("packed") + 1);

export const DEFAULT_FORECAST_DAYS = 7;
export const MAX_FORECAST_DAYS = 14;
// A piece-priced order has no weighed kilos; capacity planning uses this working estimate.
export const ESTIMATED_GRAMS_PER_PIECE = 350;
export const MEDIUM_RISK_PCT = 70;
export const HIGH_RISK_PCT = 90;
const FINISHING_MINUTES_BUFFER = 60;
const EXPRESS_CANDIDATE_LIMIT = 100;
const GRAMS_PER_KG = 1000;
const MS_PER_HOUR = 3_600_000;
const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 86_400_000;
const NO_BOTTLENECK = "none";

// Typical hours still ahead of an order, from its status to the customer's door.
export const REMAINING_HOURS: Partial<Record<OrderStatus, number>> = {
  booked: 22,
  picked_up: 20,
  received: 18,
  sorted: 16,
  washing: 12,
  drying: 8,
  quality_check: 4,
  packed: 2,
};

/** low below 70% of capacity, medium below 90%, high from there. */
export const riskForUtilisation = (pct: number): "low" | "medium" | "high" =>
  pct >= HIGH_RISK_PCT ? "high" : pct >= MEDIUM_RISK_PCT ? "medium" : "low";

export const projectFinish = (status: OrderStatus, now: Date): Date =>
  new Date(now.getTime() + (REMAINING_HOURS[status] ?? 0) * MS_PER_HOUR);

export const dailyCapacityKg = (store: IStore, setting: ICapacitySetting | undefined): number =>
  setting?.dailyKg ?? store.capacityKgPerDay;

const addDays = (isoDate: string, days: number): string =>
  new Date(new Date(`${isoDate}T00:00:00.000Z`).getTime() + days * MS_PER_DAY).toISOString().slice(0, 10);

const round1 = (n: number) => Math.round(n * 10) / 10;

// The machine type with the least usable capacity limits the plant: that is where work queues.
export const parkBottleneck = (aggregates: IMachineAggregate[]): string => {
  const usable = (type: MachineType) =>
    aggregates.filter((a) => a.type === type && a.state !== "maintenance" && a.state !== "faulted").reduce((sum, a) => sum + a.capacityGrams, 0);
  const present = (["washer", "dryer"] as const).filter((type) => aggregates.some((a) => a.type === type));
  if (present.length === 0) return NO_BOTTLENECK;
  return present.reduce((worst, type) => (usable(type) < usable(worst) ? type : worst), present[0] as MachineType);
};

const storesInScope = async (storeId: string | null): Promise<IStore[]> => {
  if (storeId) {
    const store = await StoreQuery.findById(storeId, null);
    if (!store) throw new CustomException(STORE_NOT_FOUND, notFound);
    return [store];
  }
  return await StoreQuery.list(null, "live");
};

const planFor = async (storeId: string | null) => {
  const [stores, settings] = await Promise.all([storesInScope(storeId), CapacityQuery.settings(storeId)]);
  const byStore = new Map(settings.map((s) => [s.storeId, s]));
  const capacityKg = stores.reduce((sum, store) => sum + dailyCapacityKg(store, byStore.get(store.id)), 0);
  const reservePct =
    capacityKg === 0
      ? 0
      : Math.round(
          stores.reduce((sum, store) => sum + dailyCapacityKg(store, byStore.get(store.id)) * (byStore.get(store.id)?.expressReservePct ?? 20), 0) / capacityKg
        );
  return { capacityKg, reservePct };
};

interface IDayView {
  date: string;
  expectedOrders: number;
  capacity: number;
  committedKg: number;
  expressCommittedKg: number;
  utilisationPct: number;
  bottleneck: string;
  risk: "low" | "medium" | "high";
}

// Pure: fills every day of the window (a quiet day is a row of zeros) and judges each against capacity.
export const buildForecast = (loads: IDayLoad[], from: string, days: number, capacityKg: number, bottleneck: string): IDayView[] => {
  const byDate = new Map(loads.map((l) => [l.date, l]));
  return Array.from({ length: days }, (_, i) => {
    const date = addDays(from, i);
    const load = byDate.get(date);
    const committedKg = round1((load?.committedGrams ?? 0) / GRAMS_PER_KG);
    const utilisationPct = capacityKg > 0 ? round1((committedKg / capacityKg) * 100) : committedKg > 0 ? 100 : 0;
    return {
      date,
      expectedOrders: load?.orders ?? 0,
      capacity: capacityKg,
      committedKg,
      expressCommittedKg: round1((load?.expressGrams ?? 0) / GRAMS_PER_KG),
      utilisationPct,
      bottleneck,
      risk: riskForUtilisation(utilisationPct),
    };
  });
};

const parseDays = (value: unknown): number => {
  const raw = queryString(value, "days");
  if (raw === undefined) return DEFAULT_FORECAST_DAYS;
  const days = Number(raw);
  if (!Number.isInteger(days) || days < 1 || days > MAX_FORECAST_DAYS) {
    throw new CustomException(`days must be a whole number from 1 to ${MAX_FORECAST_DAYS}.`, badRequest);
  }
  return days;
};

const loadsFor = (storeId: string | null, from: string, days: number) =>
  CapacityQuery.dayLoads(storeId, from, addDays(from, days), IN_PLANT, ESTIMATED_GRAMS_PER_PIECE);

const getCapacityForecast = async (scope: StoreScope, query: Record<string, unknown>) => {
  try {
    const storeId = resolveStoreFilter(scope, query.storeId, false);
    const days = parseDays(query.days);
    const from = localDate(new Date());
    const [plan, loads, aggregates] = await Promise.all([planFor(storeId), loadsFor(storeId, from, days), CapacityQuery.machineAggregates(storeId)]);
    return { storeId, days: buildForecast(loads, from, days, plan.capacityKg, parkBottleneck(aggregates)) };
  } catch (error) {
    throw toCustomException(error);
  }
};

const BUSY_STATES = ["reserved", "running"];
const OUT_OF_SERVICE = ["maintenance", "faulted"];

const stageTotals = (aggregates: IMachineAggregate[], type: MachineType, key: string, name: string) => {
  const ofType = aggregates.filter((a) => a.type === type && !OUT_OF_SERVICE.includes(a.state));
  const totalKg = ofType.reduce((sum, a) => sum + a.capacityGrams, 0) / GRAMS_PER_KG;
  const usedKg = ofType.filter((a) => BUSY_STATES.includes(a.state)).reduce((sum, a) => sum + a.capacityGrams, 0) / GRAMS_PER_KG;
  return { key, name, totalKg, usedKg, freeKg: totalKg - usedKg };
};

const getCapacityNow = async (scope: StoreScope, query: Record<string, unknown>, now: Date = new Date()) => {
  try {
    const storeId = resolveStoreFilter(scope, query.storeId, false);
    const today = localDate(now);
    const [plan, loads, aggregates] = await Promise.all([planFor(storeId), loadsFor(storeId, today, 1), CapacityQuery.machineAggregates(storeId)]);
    const count = (states: string[]) => aggregates.filter((a) => states.includes(a.state)).reduce((sum, a) => sum + a.count, 0);
    const total = aggregates.reduce((sum, a) => sum + a.count, 0);
    const busy = count(BUSY_STATES);
    const free = count(["idle"]);

    const todayLoad = loads.find((l) => l.date === today);
    const committedKg = (todayLoad?.committedGrams ?? 0) / GRAMS_PER_KG;
    const expressKg = (todayLoad?.expressGrams ?? 0) / GRAMS_PER_KG;
    // Standard intake closes at the share of capacity kept back for express; express may use the rest.
    const standardLimitKg = (plan.capacityKg * (100 - plan.reservePct)) / 100;
    const stages = [stageTotals(aggregates, "washer", "washing", "Washing"), stageTotals(aggregates, "dryer", "drying", "Drying")].filter((s) => s.totalKg > 0);
    const tightest = stages.reduce<(typeof stages)[number] | null>((worst, s) => (worst === null || s.freeKg < worst.freeKg ? s : worst), null);

    return {
      asOf: now.toISOString(),
      storeId,
      machines: { total, busy, free, outOfService: count(OUT_OF_SERVICE) },
      // Staff on shift (HR) and riders (logistics) are other modules' numbers; they are not guessed here.
      staff: null,
      riders: null,
      bottleneck: total > 0 && free === 0 ? "machines" : NO_BOTTLENECK,
      expressCanAccept: free > 0 && committedKg < plan.capacityKg,
      standardCanAccept: free > 0 && committedKg - expressKg < standardLimitKg,
      dailyCapacityKg: plan.capacityKg,
      committedTodayKg: round1(committedKg),
      stages,
      bottleneckKey: tightest?.key ?? null,
      acceptableKg: tightest ? tightest.freeKg : 0,
    };
  } catch (error) {
    throw toCustomException(error);
  }
};

// Pure: an express order is at risk when its projected finish is within an hour of its promise or past it.
export const judgeExpress = (
  candidates: { orderId: string; ref: string; storeId: string; status: string; promisedAt: Date }[],
  now: Date
) =>
  candidates
    .map((order) => {
      const projectedAt = projectFinish(order.status as OrderStatus, now);
      return {
        orderId: order.orderId,
        orderNumber: order.ref,
        storeId: order.storeId,
        promisedAt: order.promisedAt.toISOString(),
        projectedAt: projectedAt.toISOString(),
        delayMinutes: Math.round((projectedAt.getTime() - order.promisedAt.getTime()) / MS_PER_MINUTE),
        stage: ORDER_STATUS_LABEL[order.status as OrderStatus] ?? order.status,
      };
    })
    .filter((order) => order.delayMinutes > -FINISHING_MINUTES_BUFFER)
    .sort((a, b) => b.delayMinutes - a.delayMinutes || a.orderNumber.localeCompare(b.orderNumber));

const listExpressAtRisk = async (scope: StoreScope, query: Record<string, unknown>, now: Date = new Date()) => {
  try {
    const storeId = resolveStoreFilter(scope, query.storeId, false);
    if (storeId) await storesInScope(storeId);
    const candidates = await CapacityQuery.expressCandidates(storeId, IN_PLANT, EXPRESS_CANDIDATE_LIMIT);
    return { orders: judgeExpress(candidates, now) };
  } catch (error) {
    throw toCustomException(error);
  }
};

// For other modules: set a store's daily capacity or express reserve. No endpoint of its own yet.
const saveSetting = async (storeId: string, change: { dailyKg?: number | null; expressReservePct?: number }) => {
  try {
    if (change.dailyKg !== undefined && change.dailyKg !== null && (!Number.isInteger(change.dailyKg) || change.dailyKg < 1 || change.dailyKg > 100_000)) {
      throw new CustomException("dailyKg must be a whole number of kilograms from 1 to 100000.", badRequest);
    }
    if (change.expressReservePct !== undefined && (!Number.isInteger(change.expressReservePct) || change.expressReservePct < 0 || change.expressReservePct > 90)) {
      throw new CustomException("expressReservePct must be a whole number from 0 to 90.", badRequest);
    }
    if (!(await StoreQuery.findById(storeId, null))) throw new CustomException(STORE_NOT_FOUND, notFound);
    const [current] = await CapacityQuery.settings(storeId);
    return await CapacityQuery.saveSetting({
      storeId,
      dailyKg: change.dailyKg === undefined ? (current?.dailyKg ?? null) : change.dailyKg,
      expressReservePct: change.expressReservePct ?? current?.expressReservePct ?? 20,
    });
  } catch (error) {
    throw toCustomException(error);
  }
};

export const CapacityService = { getCapacityForecast, getCapacityNow, listExpressAtRisk, saveSetting };
