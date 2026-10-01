import { CustomException } from "../../commons/Exception/CustomException.js";
import { toCustomException } from "../../commons/Exception/ToCustomException.js";
import { parsePage } from "../../commons/Utils/Pagination.js";
import { badRequest, conflict } from "../../commons/Utils/StatusCode.js";
import type { RequestUser } from "../Middleware/Identity.js";
import type { StoreScope } from "../Middleware/StoreScope.js";
import type { IResourceReading } from "../Models/StoreAdmin/StoreAdmin.Interface.js";
import { isUniqueViolation } from "../Queries/DatabaseError.js";
import { StoreDayOpsQuery } from "../Queries/StoreDayOps.Query.js";
import { StoreSignalsQuery } from "../Queries/StoreSignals.Query.js";
import { StoreStockQuery } from "../Queries/StoreStock.Query.js";
import { optionalText, parseBody } from "../Utils/Input.js";
import { milliToUnits, parseDateRange, parseRecentDate, todayIst, toMilli } from "../Utils/StoreAdminInput.js";
import { actorNameOf, requireStore } from "./StoreAccess.js";
import { alertLevel } from "./StoreStock.Service.js";

// Per day, far above any laundry: they only stop a typo.
const MAX_WATER_MILLI = 1_000_000_000;
const MAX_ELECTRICITY_MILLI = 100_000_000;
const MAX_DETERGENT_MILLI = 10_000_000;
const MAX_TASK_ROWS = 50;

export const percent = (part: number, whole: number): number | null =>
  whole === 0 ? null : Math.round((part / whole) * 1000) / 10;

const toReadingView = (reading: IResourceReading) => ({
  id: reading.id,
  date: reading.date,
  waterLitres: reading.waterMilliLitres === null ? null : milliToUnits(reading.waterMilliLitres),
  electricityKwh: reading.electricityMilliKwh === null ? null : milliToUnits(reading.electricityMilliKwh),
  detergentKg: reading.detergentMilliKg === null ? null : milliToUnits(reading.detergentMilliKg),
  notes: reading.notes,
  recordedBy: reading.byName,
});

const optionalMilli = (value: unknown, field: string, max: number): number | null =>
  value === undefined || value === null ? null : toMilli(value, field, max, true);

const recordResourceReading = async (scope: StoreScope, user: RequestUser, storeId: string, input: unknown, now = new Date()) => {
  try {
    const body = parseBody(input);
    const date = parseRecentDate(body.date, "date", now);
    const waterMilliLitres = optionalMilli(body.waterLitres, "waterLitres", MAX_WATER_MILLI);
    const electricityMilliKwh = optionalMilli(body.electricityKwh, "electricityKwh", MAX_ELECTRICITY_MILLI);
    const detergentMilliKg = optionalMilli(body.detergentKg, "detergentKg", MAX_DETERGENT_MILLI);
    if (waterMilliLitres === null && electricityMilliKwh === null && detergentMilliKg === null) {
      throw new CustomException("Give at least one of waterLitres, electricityKwh or detergentKg.", badRequest);
    }
    const notes = optionalText(body.notes, "notes", 500) ?? null;
    await requireStore(storeId, scope);

    try {
      const reading = await StoreDayOpsQuery.createReading({
        storeId,
        date,
        waterMilliLitres,
        electricityMilliKwh,
        detergentMilliKg,
        notes,
        byUserId: user.id,
        byName: actorNameOf(user),
      });
      return toReadingView(reading);
    } catch (error) {
      if (isUniqueViolation(error, "resource_reading")) {
        throw new CustomException("A reading for this date is already recorded.", conflict);
      }
      throw error;
    }
  } catch (error) {
    throw toCustomException(error);
  }
};

const listResourceReadings = async (scope: StoreScope, storeId: string, query: Record<string, unknown>) => {
  try {
    const page = parsePage(query);
    const range = parseDateRange(query);
    await requireStore(storeId, scope);
    const result = await StoreDayOpsQuery.listReadings(storeId, range.from, range.to, page);
    return { ...result, items: result.items.map(toReadingView) };
  } catch (error) {
    throw toCustomException(error);
  }
};

// Order figures cover orders placed in the range. Quality is read from rework: an order that
// was sent back a stage counts against the store and against whoever handled it.
const getStorePerformance = async (scope: StoreScope, storeId: string, query: Record<string, unknown>, now = new Date()) => {
  try {
    const range = parseDateRange(query, now);
    await requireStore(storeId, scope);

    const [processed, [metrics], reworked, complaints, staff] = await Promise.all([
      StoreSignalsQuery.countProcessed(storeId, range.start, range.end),
      StoreSignalsQuery.metricsFor([storeId], range.start, range.end),
      StoreSignalsQuery.countReworked(storeId, range.start, range.end),
      StoreSignalsQuery.openComplaints([storeId]),
      StoreSignalsQuery.staffOf(storeId, todayIst(now)),
    ]);
    const userIds = staff.flatMap((s) => (s.gatewayUserId ? [s.gatewayUserId] : []));
    const handled = new Map(
      (await StoreSignalsQuery.staffHandled(storeId, userIds, range.start, range.end)).map((h) => [h.userId, h])
    );

    return {
      from: range.from,
      to: range.to,
      ordersProcessed: processed,
      onTimePct: percent(metrics?.onTime ?? 0, metrics?.delivered ?? 0),
      qualityFailPct: percent(reworked, metrics?.orders ?? 0),
      complaintsOpen: complaints.get(storeId) ?? 0,
      staff: staff.map((member) => {
        const stats = member.gatewayUserId ? handled.get(member.gatewayUserId) : undefined;
        const ordersHandled = stats?.ordersHandled ?? 0;
        return {
          employeeId: member.employeeId,
          name: member.name,
          ordersHandled,
          qualityScore: stats ? percent(ordersHandled - stats.reworkedOrders, ordersHandled) : null,
        };
      }),
    };
  } catch (error) {
    throw toCustomException(error);
  }
};

const listStoreStaff = async (scope: StoreScope, storeId: string, now = new Date()) => {
  try {
    await requireStore(storeId, scope);
    const staff = await StoreSignalsQuery.staffOf(storeId, todayIst(now));
    return { staff: staff.map(({ employeeId, name, role, onShift }) => ({ employeeId, name, role, onShift })) };
  } catch (error) {
    throw toCustomException(error);
  }
};

const getStoreTasksToday = async (scope: StoreScope, storeId: string, now = new Date()) => {
  try {
    await requireStore(storeId, scope);
    const today = todayIst(now);
    const [machineChecksDue, servicingDue, stock] = await Promise.all([
      StoreSignalsQuery.machinesWithoutCheck(storeId, today),
      StoreSignalsQuery.servicingDue(storeId, today),
      StoreStockQuery.select({ storeId, alertsOnly: true, newestAlertFirst: true, offset: 0, limit: MAX_TASK_ROWS }),
    ]);
    return {
      machineChecksDue,
      servicingDue,
      lowStock: stock.rows.map((row) => ({ itemId: row.id, name: row.name, level: alertLevel(row) })),
    };
  } catch (error) {
    throw toCustomException(error);
  }
};

export const StoreDayOpsService = {
  recordResourceReading,
  listResourceReadings,
  getStorePerformance,
  listStoreStaff,
  getStoreTasksToday,
};
