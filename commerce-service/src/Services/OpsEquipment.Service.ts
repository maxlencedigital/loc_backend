import { CustomException } from "../../commons/Exception/CustomException.js";
import { toCustomException } from "../../commons/Exception/ToCustomException.js";
import { parsePage, toPage } from "../../commons/Utils/Pagination.js";
import { badRequest, conflict, notFound } from "../../commons/Utils/StatusCode.js";
import type { RequestUser } from "../Middleware/Identity.js";
import { StoreScope } from "../Middleware/StoreScope.js";
import {
  EQUIPMENT_STATUSES,
  EQUIPMENT_TRANSITIONS,
  EQUIPMENT_TYPES,
  EquipmentStatus,
  IEquipment,
  IEquipmentCreate,
  IEquipmentUpdate,
  IStatusEvent,
} from "../Models/Equipment/Equipment.Interface.js";
import { isUniqueViolation } from "../Queries/DatabaseError.js";
import { EquipmentMachines } from "./EquipmentMachines.js";
import { EquipmentQuery } from "../Queries/Equipment.Query.js";
import { EquipmentMaintenanceQuery } from "../Queries/EquipmentMaintenance.Query.js";
import { EquipmentRecordsQuery } from "../Queries/EquipmentRecords.Query.js";
import { StoreQuery } from "../Queries/Store.Query.js";
import { addDays, businessToday, clock, dateOut, notInFuture, parseDate, timeOut } from "../Utils/AssetDates.js";
import {
  actorId,
  actorName,
  amountToPaise,
  kgToGrams,
  patchAmount,
  patchDate,
  patchText,
  patchUuid,
  queryUuid,
  requireChange,
  uuidField,
} from "../Utils/AssetInput.js";
import { oneOf, optionalOneOf, optionalText, parseBody, queryString, text } from "../Utils/Input.js";
import { toRupees } from "../Utils/Money.js";
import { isUuid } from "../Utils/Uuid.js";

export const NOT_FOUND = "Equipment not found.";
const STORE_NOT_FOUND = "Store not found.";
const TAG_PATTERN = /^[A-Z0-9][A-Z0-9-]{1,31}$/;
const TAG_PREFIX = "EQ-";
const TAG_ATTEMPTS = 3;
const HISTORY_LIMIT = 50;
const DUE_SOON_DAYS = 7;
const BROKEN_DOWN_DAYS = 30;
const REVIEW_WINDOW_DAYS = 365;
const REVIEW_MAX_MACHINES = 500;

// A year of repairs costing this share of a new machine means replace; half of that, watch it.
export const REPLACE_RATIO = 0.5;
export const MONITOR_RATIO = 0.25;

export const toEquipmentView = (item: IEquipment) => ({
  id: item.id,
  assetTag: item.assetTag,
  name: item.name,
  type: item.type,
  storeId: item.storeId,
  machineId: item.machineId,
  make: item.make,
  model: item.model,
  serialNumber: item.serialNumber,
  purchasedOn: dateOut(item.purchasedOn),
  purchaseCost: item.purchaseCostPaise === null ? null : toRupees(item.purchaseCostPaise),
  capacityKg: item.capacityGrams === null ? null : item.capacityGrams / 1000,
  status: item.status,
  retiredAt: timeOut(item.retiredAt),
  retiredReason: item.retiredReason,
  createdAt: item.createdAt.toISOString(),
  updatedAt: item.updatedAt.toISOString(),
});

const toEventView = (event: IStatusEvent) => ({
  at: event.at.toISOString(),
  from: event.fromStatus,
  to: event.toStatus,
  reason: event.reason,
  by: event.byName,
});

// Which store a list is about. A store-bound caller who names another store is told it
// does not exist, the same answer as for any other row outside their store.
export const resolveStoreFilter = (scope: StoreScope, requested: unknown): string | null => {
  const storeId = queryUuid(requested, "storeId");
  if (scope && storeId && storeId !== scope) throw new CustomException(STORE_NOT_FOUND, notFound);
  return scope ?? storeId ?? null;
};

// A machine can only be registered in or moved to a store the caller may act in.
const assertStoreUsable = async (scope: StoreScope, storeId: string): Promise<void> => {
  if (scope && storeId !== scope) throw new CustomException(STORE_NOT_FOUND, notFound);
  if (!(await StoreQuery.findById(storeId, null))) throw new CustomException(STORE_NOT_FOUND, notFound);
};

const parseTag = (value: unknown): string => {
  const tag = text(value, "assetTag", 32).toUpperCase();
  if (!TAG_PATTERN.test(tag)) {
    throw new CustomException("assetTag must be 2 to 32 letters, digits or dashes, e.g. EQ-00042.", badRequest);
  }
  return tag;
};

const formatTag = (n: number): string => `${TAG_PREFIX}${String(n).padStart(5, "0")}`;

export const checkEquipmentTransition = (from: EquipmentStatus, to: EquipmentStatus): void => {
  if (!EQUIPMENT_TRANSITIONS[from].includes(to)) {
    const why = from === "retired" ? "A retired machine cannot be changed." : `A machine cannot move from ${from} to ${to}.`;
    throw new CustomException(why, conflict);
  }
};

const list = async (scope: StoreScope, query: Record<string, unknown>) => {
  try {
    const page = parsePage(query);
    const result = await EquipmentQuery.search(
      {
        storeId: resolveStoreFilter(scope, query.storeId),
        type: optionalOneOf(queryString(query.type, "type"), EQUIPMENT_TYPES, "type"),
        status: optionalOneOf(queryString(query.status, "status"), EQUIPMENT_STATUSES, "status"),
      },
      page
    );
    return toPage(result.items.map(toEquipmentView), result.total, page);
  } catch (error) {
    throw toCustomException(error);
  }
};

const getById = async (id: string, scope: StoreScope) => {
  try {
    const item = isUuid(id) ? await EquipmentQuery.findById(id, scope) : null;
    if (!item) throw new CustomException(NOT_FOUND, notFound);
    const history = await EquipmentQuery.listStatusEvents(id, HISTORY_LIMIT);
    return { ...toEquipmentView(item), history: history.map(toEventView) };
  } catch (error) {
    throw toCustomException(error);
  }
};

const create = async (scope: StoreScope, user: RequestUser, input: unknown) => {
  try {
    const body = parseBody(input);
    const status = optionalOneOf(body.status, EQUIPMENT_STATUSES, "status") ?? "active";
    if (status === "retired") throw new CustomException("A new machine cannot be registered as retired.", badRequest);
    const provided = body.assetTag === undefined || body.assetTag === null ? undefined : parseTag(body.assetTag);
    const data: Omit<IEquipmentCreate, "assetTag"> = {
      name: text(body.name, "name", 120),
      type: oneOf(body.type, EQUIPMENT_TYPES, "type"),
      storeId: uuidField(body.storeId, "storeId"),
      machineId: body.machineId === undefined || body.machineId === null ? null : uuidField(body.machineId, "machineId"),
      make: optionalText(body.make, "make", 80) ?? null,
      model: optionalText(body.model, "model", 80) ?? null,
      serialNumber: optionalText(body.serialNumber, "serialNumber", 80) ?? null,
      purchasedOn: body.purchasedOn === undefined || body.purchasedOn === null ? null : notInFuture(parseDate(body.purchasedOn, "purchasedOn"), "purchasedOn"),
      purchaseCostPaise: body.purchaseCost === undefined || body.purchaseCost === null ? null : amountToPaise(body.purchaseCost, "purchaseCost"),
      capacityGrams: body.capacityKg === undefined || body.capacityKg === null ? null : kgToGrams(body.capacityKg, "capacityKg"),
      status,
      createdByUserId: actorId(user),
    };
    await assertStoreUsable(scope, data.storeId);

    const event = { fromStatus: null, toStatus: status, reason: "Registered", byUserId: actorId(user), byName: actorName(user) };
    // A generated tag can meet one typed in by hand; draw the next number instead of failing.
    for (let attempt = 0; attempt < TAG_ATTEMPTS; attempt++) {
      const assetTag = provided ?? formatTag(await EquipmentQuery.nextTagNumber());
      try {
        const machineId = data.machineId ?? (await EquipmentMachines.register({ ...data, assetTag }));
        return toEquipmentView(await EquipmentQuery.create({ ...data, assetTag, machineId }, event));
      } catch (error) {
        if (!isUniqueViolation(error, "assetTag")) throw error;
        if (provided) throw new CustomException("An equipment item with this asset tag already exists.", conflict);
      }
    }
    throw new CustomException("Could not allocate an asset tag. Please try again.", conflict);
  } catch (error) {
    throw toCustomException(error);
  }
};

const update = async (id: string, scope: StoreScope, user: RequestUser, input: unknown) => {
  try {
    if (!isUuid(id)) throw new CustomException(NOT_FOUND, notFound);
    const body = parseBody(input);
    const data: IEquipmentUpdate = {};
    if (body.name !== undefined) data.name = text(body.name, "name", 120);
    if (body.type !== undefined) data.type = oneOf(body.type, EQUIPMENT_TYPES, "type");
    if (body.storeId !== undefined) data.storeId = uuidField(body.storeId, "storeId");
    const machineId = patchUuid(body.machineId, "machineId");
    if (machineId !== undefined) data.machineId = machineId;
    const make = patchText(body.make, "make", 80);
    if (make !== undefined) data.make = make;
    const model = patchText(body.model, "model", 80);
    if (model !== undefined) data.model = model;
    const serial = patchText(body.serialNumber, "serialNumber", 80);
    if (serial !== undefined) data.serialNumber = serial;
    const purchasedOn = patchDate(body.purchasedOn, "purchasedOn");
    if (purchasedOn !== undefined) data.purchasedOn = purchasedOn === null ? null : notInFuture(purchasedOn, "purchasedOn");
    const cost = patchAmount(body.purchaseCost, "purchaseCost");
    if (cost !== undefined) data.purchaseCostPaise = cost;
    if (body.capacityKg !== undefined) data.capacityGrams = body.capacityKg === null ? null : kgToGrams(body.capacityKg, "capacityKg");
    const target = body.status === undefined ? undefined : oneOf(body.status, EQUIPMENT_STATUSES, "status");
    if (target === "retired") throw new CustomException("Use the retire action to retire a machine.", badRequest);
    if (target) data.status = target;
    requireChange(data);
    if (data.storeId) await assertStoreUsable(scope, data.storeId);

    const updated = await EquipmentQuery.inTransaction(async (tx) => {
      const current = await EquipmentQuery.lockById(id, scope, tx);
      if (!current) throw new CustomException(NOT_FOUND, notFound);
      if (current.status === "retired") throw new CustomException("A retired machine cannot be changed.", conflict);
      const moves = target !== undefined && target !== current.status;
      if (moves) checkEquipmentTransition(current.status, target);
      if (!moves) delete data.status;
      const event = moves
        ? { fromStatus: current.status, toStatus: target, reason: null, byUserId: actorId(user), byName: actorName(user) }
        : null;
      return await EquipmentQuery.update(id, data, event, tx);
    });
    return toEquipmentView(updated);
  } catch (error) {
    throw toCustomException(error);
  }
};

// Retiring ends the schedule (nothing is left to service) but keeps every record.
const retire = async (id: string, scope: StoreScope, user: RequestUser, input: unknown) => {
  try {
    const reason = text(parseBody(input).reason, "reason", 500);
    if (!isUuid(id)) throw new CustomException(NOT_FOUND, notFound);
    const retired = await EquipmentQuery.inTransaction(async (tx) => {
      const current = await EquipmentQuery.lockById(id, scope, tx);
      if (!current) throw new CustomException(NOT_FOUND, notFound);
      checkEquipmentTransition(current.status, "retired");
      const done = await EquipmentQuery.update(
        id,
        { status: "retired", retiredAt: clock.now(), retiredReason: reason },
        { fromStatus: current.status, toStatus: "retired", reason, byUserId: actorId(user), byName: actorName(user) },
        tx
      );
      await EquipmentMaintenanceQuery.deleteForEquipment(id, tx);
      return done;
    });
    return toEquipmentView(retired);
  } catch (error) {
    throw toCustomException(error);
  }
};

const summary = async (scope: StoreScope, query: Record<string, unknown>) => {
  try {
    const storeId = resolveStoreFilter(scope, query.storeId);
    const today = businessToday();
    const [counts, due, overdue, brokenDown] = await Promise.all([
      EquipmentQuery.countByStatus(storeId),
      EquipmentMaintenanceQuery.countDue({ storeId, from: today, to: addDays(today, DUE_SOON_DAYS) }),
      EquipmentMaintenanceQuery.countDue({ storeId, to: addDays(today, -1) }),
      EquipmentQuery.countWithRepairSince(storeId, addDays(today, -BROKEN_DOWN_DAYS)),
    ]);
    const byStatus = Object.fromEntries(EQUIPMENT_STATUSES.map((s) => [s, counts[s] ?? 0]));
    return {
      total: Object.values(byStatus).reduce((sum, n) => sum + n, 0),
      byStatus,
      serviceDue: due,
      serviceOverdue: overdue,
      brokenDownLast30Days: brokenDown,
    };
  } catch (error) {
    throw toCustomException(error);
  }
};

export const recommend = (repairCostPaise: number, replacementPaise: number): "keep" | "monitor" | "replace" => {
  // Without a purchase price there is nothing to compare against, so a human should look.
  if (replacementPaise <= 0) return "monitor";
  const ratio = repairCostPaise / replacementPaise;
  return ratio >= REPLACE_RATIO ? "replace" : ratio >= MONITOR_RATIO ? "monitor" : "keep";
};

// Live machines that had repairs in the last year, worst ratio first. Spend is summed in
// SQL; the answer is bounded to the 500 machines with the most spend.
const replacementReview = async (scope: StoreScope, query: Record<string, unknown>) => {
  try {
    const page = parsePage(query);
    const storeId = resolveStoreFilter(scope, query.storeId);
    const since = addDays(businessToday(), -REVIEW_WINDOW_DAYS);
    const spend = (await EquipmentRecordsQuery.repairSpendSince(storeId, since, REVIEW_MAX_MACHINES)).filter((s) => s.costPaise > 0);
    const machines = new Map((await EquipmentQuery.findManyByIds(spend.map((s) => s.equipmentId))).map((m) => [m.id, m]));
    const rows = spend
      .flatMap((s) => {
        const machine = machines.get(s.equipmentId);
        return machine ? [{ machine, repairPaise: s.costPaise, replacementPaise: machine.purchaseCostPaise ?? 0 }] : [];
      })
      .map((r) => ({ ...r, ratio: r.replacementPaise > 0 ? r.repairPaise / r.replacementPaise : Number.POSITIVE_INFINITY }))
      .sort((a, b) => b.ratio - a.ratio || a.machine.id.localeCompare(b.machine.id));
    const items = rows.slice(page.offset, page.offset + page.limit).map((r) => ({
      equipmentId: r.machine.id,
      name: r.machine.name,
      repairCost12Months: toRupees(r.repairPaise),
      replacementCost: toRupees(r.replacementPaise),
      recommendation: recommend(r.repairPaise, r.replacementPaise),
    }));
    return toPage(items, rows.length, page);
  } catch (error) {
    throw toCustomException(error);
  }
};

export const OpsEquipmentService = { list, getById, create, update, retire, summary, replacementReview };
