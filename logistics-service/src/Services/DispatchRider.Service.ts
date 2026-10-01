import { CustomException } from "../../commons/Exception/CustomException.js";
import { toCustomException } from "../../commons/Exception/ToCustomException.js";
import { parsePage, toPage } from "../../commons/Utils/Pagination.js";
import { badRequest, conflict, notFound } from "../../commons/Utils/StatusCode.js";
import { RIDER_STATUSES, IRider } from "../Models/Rider/Rider.Interface.js";
import { Actor, StoreScope } from "../Middleware/StoreScope.js";
import { EarningsQuery } from "../Queries/Earnings.Query.js";
import { JobQuery } from "../Queries/Job.Query.js";
import { RiderQuery } from "../Queries/Rider.Query.js";
import { dateTime, dayRange, istDateOf, parseDate, toDateColumn } from "../Utils/Dates.js";
import { haversineKm, paiseToRupees, rupeesToPaise, round1 } from "../Utils/Geo.js";
import { decimal, isBlank, object, optionalOneOf, optionalUuid, queryText, text, uuid } from "../Utils/Input.js";
import { isUuid } from "../Utils/Uuid.js";
import { eligibilityBlockers } from "./Eligibility.js";
import { MAX_ACTIVE_JOBS_PER_RIDER } from "./DispatchJob.Service.js";

const AVAILABLE_LIMIT = 100;
const NEAR_JOB_ANCHORS = 50;
const FRESH_LOCATION_MS = 30 * 60_000;

const checkStore = (scope: StoreScope, storeId: string | null): void => {
  if (scope !== null && storeId !== null && storeId !== scope) throw new CustomException("Store not found.", notFound);
};

const loadRider = async (id: string): Promise<IRider> => {
  const rider = isUuid(id) ? await RiderQuery.findRiderById(id) : null;
  if (!rider) throw new CustomException("Rider not found.", notFound);
  return rider;
};

const booleanQuery = (value: unknown, name: string): boolean | null => {
  const raw = queryText(value, name, 5);
  if (raw === null) return null;
  if (raw !== "true" && raw !== "false") throw new CustomException(`${name} must be true or false.`, badRequest);
  return raw === "true";
};

// ----------------------------------------------------------------------- riders

const list = async (query: { storeId?: unknown; available?: unknown; status?: unknown; page?: unknown; limit?: unknown }) => {
  try {
    const homeStoreId = optionalUuid(query.storeId, "storeId");
    const available = booleanQuery(query.available, "available");
    const status = optionalOneOf(isBlank(query.status) ? null : query.status, RIDER_STATUSES, "status");
    const page = parsePage(query);
    const { items, total } = await RiderQuery.listRiders({ homeStoreId, available, status }, page);
    // Riders move between stores, so the list is not store-scoped; the filter is the rider's home store.
    const load = await JobQuery.activeCounts(items.map((r) => r.id));
    return toPage(
      items.map((r) => ({
        id: r.id,
        name: r.name,
        phone: r.phone,
        available: r.available,
        status: r.status,
        activeJobs: load.get(r.id) ?? 0,
        onShift: r.openShiftId !== null,
        homeStoreId: r.homeStoreId,
      })),
      total,
      page
    );
  } catch (error) {
    throw toCustomException(error);
  }
};

const available = async (scope: StoreScope, query: { storeId?: unknown; at?: unknown }) => {
  try {
    const storeId = uuid(query.storeId, "storeId");
    checkStore(scope, storeId);
    const at = isBlank(query.at) ? new Date() : dateTime(query.at, "at");

    const candidates = await RiderQuery.listCandidates({ today: toDateColumn(istDateOf(at)), onShiftOnly: true, limit: AVAILABLE_LIMIT });
    const riders = candidates.filter((r) => eligibilityBlockers(r, at).length === 0);
    const [load, waiting] = await Promise.all([
      JobQuery.activeCounts(riders.map((r) => r.id)),
      JobQuery.listUnassigned({ storeId }, NEAR_JOB_ANCHORS),
    ]);
    // Distance is to the nearest job still waiting at this store: the store's own position is commerce's.
    const anchors = waiting.filter((j) => j.latitude !== null && j.longitude !== null);

    const rows = riders
      .filter((r) => (load.get(r.id) ?? 0) < MAX_ACTIVE_JOBS_PER_RIDER)
      .map((r) => {
        const fresh = r.lastLocationAt !== null && Date.now() - r.lastLocationAt.getTime() <= FRESH_LOCATION_MS;
        const km =
          fresh && r.lastLatitude !== null && r.lastLongitude !== null && anchors.length > 0
            ? Math.min(...anchors.map((j) => haversineKm({ latitude: j.latitude as number, longitude: j.longitude as number }, { latitude: r.lastLatitude as number, longitude: r.lastLongitude as number })))
            : null;
        return { id: r.id, name: r.name, distanceKm: km === null ? null : round1(km), activeJobs: load.get(r.id) ?? 0 };
      })
      .sort((a, b) => a.activeJobs - b.activeJobs || (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity));
    return { riders: rows };
  } catch (error) {
    throw toCustomException(error);
  }
};

const get = async (id: string) => {
  try {
    const rider = await loadRider(id);
    const activeJobs = (await JobQuery.activeCounts([rider.id])).get(rider.id) ?? 0;
    return {
      id: rider.id,
      name: rider.name,
      phone: rider.phone,
      city: rider.city,
      vehicleType: rider.vehicleType,
      vehicleNumber: rider.vehicleNumber,
      homeStoreId: rider.homeStoreId,
      status: rider.status,
      available: rider.available,
      onShift: rider.openShiftId !== null,
      activeJobs,
      insuranceExpiry: rider.insuranceExpiry ? istDateOf(rider.insuranceExpiry) : null,
      suspendedReason: rider.suspendedReason,
    };
  } catch (error) {
    throw toCustomException(error);
  }
};

// A rider's position is shared only while they are on shift.
const location = async (id: string) => {
  try {
    const rider = await loadRider(id);
    if (rider.openShiftId === null || rider.lastLatitude === null || rider.lastLongitude === null || !rider.lastLocationAt) {
      throw new CustomException("This rider's location is not available.", notFound);
    }
    return { latitude: rider.lastLatitude, longitude: rider.lastLongitude, at: rider.lastLocationAt.toISOString() };
  } catch (error) {
    throw toCustomException(error);
  }
};

const cashBalance = async (id: string) => {
  try {
    const rider = await loadRider(id);
    const cash = await EarningsQuery.cashTotals(rider.id);
    return {
      collected: paiseToRupees(cash.collectedPaise),
      settled: paiseToRupees(cash.settledPaise),
      outstanding: paiseToRupees(cash.collectedPaise - cash.settledPaise),
    };
  } catch (error) {
    throw toCustomException(error);
  }
};

// --------------------------------------------------------------- field payments

const paymentCard = (p: Awaited<ReturnType<typeof EarningsQuery.findFieldPaymentById>> & object) => ({
  id: p.id,
  riderId: p.riderId,
  orderId: p.orderId,
  amount: paiseToRupees(p.amountPaise),
  method: p.method,
  status: p.status,
  collectedAt: p.collectedAt.toISOString(),
});

const listFieldPayments = async (
  scope: StoreScope,
  query: { riderId?: unknown; status?: unknown; from?: unknown; to?: unknown; page?: unknown; limit?: unknown }
) => {
  try {
    const riderId = optionalUuid(query.riderId, "riderId");
    const status = optionalOneOf(isBlank(query.status) ? null : query.status, ["collected", "settled"] as const, "status");
    const from = isBlank(query.from) ? null : dayRange(parseDate(query.from, "from")).from;
    const to = isBlank(query.to) ? null : dayRange(parseDate(query.to, "to")).to;
    const page = parsePage(query);
    const { items, total } = await EarningsQuery.listFieldPayments({ storeId: scope, riderId, status, from, to }, page);
    return toPage(items.map(paymentCard), total, page);
  } catch (error) {
    throw toCustomException(error);
  }
};

const scopedPayment = async (scope: StoreScope, id: string) => {
  const payment = isUuid(id) ? await EarningsQuery.findFieldPaymentById(id) : null;
  if (!payment || (scope !== null && payment.storeId !== scope)) throw new CustomException("Field payment not found.", notFound);
  return payment;
};

const getFieldPayment = async (scope: StoreScope, id: string) => {
  try {
    const p = await scopedPayment(scope, id);
    return {
      ...paymentCard(p),
      jobId: p.jobId,
      storeId: p.storeId,
      reference: p.reference,
      settledAt: p.settledAt ? p.settledAt.toISOString() : null,
      settledAmount: p.settledAmountPaise === null ? null : paiseToRupees(p.settledAmountPaise),
      settleNote: p.settleNote,
    };
  } catch (error) {
    throw toCustomException(error);
  }
};

const settleFieldPayment = async (actor: Actor, scope: StoreScope, id: string, body: unknown) => {
  try {
    const input = object(body ?? {}, "body");
    const settledPaise = rupeesToPaise(decimal(input.settledAmount, "settledAmount", 0.01, 20_000_000));
    const storeId = optionalUuid(input.storeId, "storeId");
    checkStore(scope, storeId);
    const note = text(input.note, "note", { max: 500 });
    const payment = await scopedPayment(scope, id);

    if (payment.method !== "cash") throw new CustomException("Only cash has to be handed over; this payment needs no settlement.", conflict);
    if (payment.status === "settled") throw new CustomException("This payment is already settled.", conflict);
    if (settledPaise !== payment.amountPaise) throw new CustomException("The amount does not match what was collected.", conflict);

    // Only a still-collected payment can be settled, so two staff settling at once settle it once.
    const done = await EarningsQuery.settleFieldPayment(payment.id, {
      settledAmountPaise: settledPaise,
      settledByUserId: actor.id,
      settledStoreId: storeId ?? scope ?? payment.storeId,
      settleNote: note,
    });
    if (!done) throw new CustomException("This payment is already settled.", conflict);
    return { id: payment.id, status: "settled", settledAmount: paiseToRupees(settledPaise) };
  } catch (error) {
    throw toCustomException(error);
  }
};

export const DispatchRiderService = {
  list,
  available,
  get,
  location,
  cashBalance,
  listFieldPayments,
  getFieldPayment,
  settleFieldPayment,
};
