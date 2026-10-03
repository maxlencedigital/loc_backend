import { CustomException } from "../../commons/Exception/CustomException.js";
import { toCustomException } from "../../commons/Exception/ToCustomException.js";
import { parsePage, toPage } from "../../commons/Utils/Pagination.js";
import { badRequest, conflict, notFound } from "../../commons/Utils/StatusCode.js";
import type { RequestUser } from "../Middleware/Identity.js";
import { StoreScope } from "../Middleware/StoreScope.js";
import { IChecklistItem, IEquipment, INSPECTION_RESULTS, IRepair, IRepairUpdate } from "../Models/Equipment/Equipment.Interface.js";
import { EquipmentQuery } from "../Queries/Equipment.Query.js";
import { EquipmentRecordsQuery } from "../Queries/EquipmentRecords.Query.js";
import { MS_PER_DAY, MS_PER_MINUTE, addDays, businessToday, clock, dateOut, notInFuture, parseDate } from "../Utils/AssetDates.js";
import { actorId, actorName, amountToPaise, hoursToMinutes, minutesToHours, requireChange, uuidField } from "../Utils/AssetInput.js";
import { oneOf, optionalText, parseBody, queryString, text } from "../Utils/Input.js";
import { toRupees } from "../Utils/Money.js";
import { isUuid } from "../Utils/Uuid.js";
import { EquipmentMachines } from "./EquipmentMachines.js";
import { NOT_FOUND } from "./OpsEquipment.Service.js";

const MAX_CHECKLIST_ITEMS = 50;
const MAX_DOWNTIME_PERIODS = 500;
const DEFAULT_DOWNTIME_DAYS = 90;
const MAX_DOWNTIME_RANGE_DAYS = 3660;
const REPAIR_NOT_FOUND = "Repair not found.";

const toInspectionView = (i: { id: string; inspectedOn: Date; result: string; checklist: IChecklistItem[]; notes: string | null; inspectorName: string }) => ({
  id: i.id,
  date: dateOut(i.inspectedOn),
  result: i.result,
  checklist: i.checklist,
  notes: i.notes,
  inspector: i.inspectorName,
});

export const toRepairView = (r: IRepair) => ({
  id: r.id,
  reportedOn: dateOut(r.reportedOn),
  issue: r.issue,
  cost: r.costPaise === null ? null : toRupees(r.costPaise),
  vendorId: r.vendorId,
  resolvedOn: dateOut(r.resolvedOn),
  downtimeHours: r.downtimeMinutes === null ? null : minutesToHours(r.downtimeMinutes),
  notes: r.notes,
});

const parseChecklist = (value: unknown): IChecklistItem[] => {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > MAX_CHECKLIST_ITEMS) {
    throw new CustomException(`checklist must be a list of at most ${MAX_CHECKLIST_ITEMS} items.`, badRequest);
  }
  return value.map((entry) => {
    const row = parseBody(entry);
    if (typeof row.ok !== "boolean") throw new CustomException("Each checklist item needs ok as true or false.", badRequest);
    return { item: text(row.item, "checklist item", 200), ok: row.ok };
  });
};

// The machine, if the caller may see it. Anything outside their store is simply not found.
const visible = async (id: string, scope: StoreScope): Promise<IEquipment> => {
  const item = isUuid(id) ? await EquipmentQuery.findById(id, scope) : null;
  if (!item) throw new CustomException(NOT_FOUND, notFound);
  return item;
};

const recordInspection = async (id: string, scope: StoreScope, user: RequestUser, input: unknown) => {
  try {
    const body = parseBody(input);
    const data = {
      inspectedOn: notInFuture(parseDate(body.date, "date"), "date"),
      result: oneOf(body.result, INSPECTION_RESULTS, "result"),
      checklist: parseChecklist(body.checklist),
      notes: optionalText(body.notes, "notes", 1000) ?? null,
      inspectorUserId: actorId(user),
      inspectorName: actorName(user),
    };
    const machine = await visible(id, scope);
    if (machine.status === "retired") throw new CustomException("A retired machine cannot be inspected.", conflict);
    return toInspectionView(await EquipmentRecordsQuery.createInspection(id, data));
  } catch (error) {
    throw toCustomException(error);
  }
};

const listInspections = async (id: string, scope: StoreScope, query: Record<string, unknown>) => {
  try {
    const page = parsePage(query);
    await visible(id, scope);
    const result = await EquipmentRecordsQuery.listInspections(id, page);
    return toPage(result.items.map(toInspectionView), result.total, page);
  } catch (error) {
    throw toCustomException(error);
  }
};

// Reporting a repair takes a working machine out of service in the same transaction, so the
// lifecycle history and the repair can never disagree.
const createRepair = async (id: string, scope: StoreScope, user: RequestUser, input: unknown) => {
  try {
    const body = parseBody(input);
    const data = {
      reportedOn: notInFuture(parseDate(body.reportedOn, "reportedOn"), "reportedOn"),
      issue: text(body.issue, "issue", 500),
      costPaise: body.cost === undefined || body.cost === null ? null : amountToPaise(body.cost, "cost"),
      vendorId: body.vendorId === undefined || body.vendorId === null ? null : uuidField(body.vendorId, "vendorId"),
      downtimeMinutes: body.downtimeHours === undefined || body.downtimeHours === null ? null : hoursToMinutes(body.downtimeHours, "downtimeHours"),
      createdByUserId: actorId(user),
    };
    if (!isUuid(id)) throw new CustomException(NOT_FOUND, notFound);

    const { repair, machineId, tookOut } = await EquipmentQuery.inTransaction(async (tx) => {
      const machine = await EquipmentQuery.lockById(id, scope, tx);
      if (!machine) throw new CustomException(NOT_FOUND, notFound);
      if (machine.status === "retired") throw new CustomException("A retired machine cannot have new repairs.", conflict);
      const created = await EquipmentRecordsQuery.createRepair(id, data, tx);
      const takeOut = machine.status === "active";
      if (takeOut) {
        await EquipmentQuery.update(
          id,
          { status: "under_repair" },
          { fromStatus: "active", toStatus: "under_repair", reason: `Repair reported: ${data.issue.slice(0, 120)}`, byUserId: actorId(user), byName: actorName(user) },
          tx
        );
      }
      return { repair: created, machineId: machine.machineId, tookOut: takeOut };
    });
    if (tookOut) await EquipmentMachines.setState(machineId, "maintenance");
    return toRepairView(repair);
  } catch (error) {
    throw toCustomException(error);
  }
};

const listRepairs = async (id: string, scope: StoreScope, query: Record<string, unknown>) => {
  try {
    const page = parsePage(query);
    await visible(id, scope);
    const result = await EquipmentRecordsQuery.listRepairs(id, page);
    return toPage(result.items.map(toRepairView), result.total, page);
  } catch (error) {
    throw toCustomException(error);
  }
};

// Closing the last open repair puts a machine that was under repair back to work.
const updateRepair = async (id: string, repairId: string, scope: StoreScope, user: RequestUser, input: unknown) => {
  try {
    const body = parseBody(input);
    const data: IRepairUpdate = {};
    if (body.cost !== undefined) data.costPaise = amountToPaise(body.cost, "cost");
    if (body.downtimeHours !== undefined) data.downtimeMinutes = hoursToMinutes(body.downtimeHours, "downtimeHours");
    if (body.notes !== undefined) data.notes = text(body.notes, "notes", 1000);
    if (body.resolvedOn !== undefined) data.resolvedOn = notInFuture(parseDate(body.resolvedOn, "resolvedOn"), "resolvedOn");
    requireChange(data);
    if (!isUuid(id)) throw new CustomException(NOT_FOUND, notFound);
    if (!isUuid(repairId)) throw new CustomException(REPAIR_NOT_FOUND, notFound);

    const { repair, machineId, backToWork } = await EquipmentQuery.inTransaction(async (tx) => {
      const machine = await EquipmentQuery.lockById(id, scope, tx);
      if (!machine) throw new CustomException(NOT_FOUND, notFound);
      const current = await EquipmentRecordsQuery.findRepair(id, repairId, tx);
      if (!current) throw new CustomException(REPAIR_NOT_FOUND, notFound);
      if (data.resolvedOn && data.resolvedOn < current.reportedOn) {
        throw new CustomException("resolvedOn cannot be before the repair was reported.", badRequest);
      }
      const updated = await EquipmentRecordsQuery.updateRepair(repairId, data, tx);
      const closing = data.resolvedOn !== undefined && current.resolvedOn === null;
      const back = closing && machine.status === "under_repair" && (await EquipmentRecordsQuery.countOpenRepairs(id, repairId, tx)) === 0;
      if (back) {
        await EquipmentQuery.update(
          id,
          { status: "active" },
          { fromStatus: "under_repair", toStatus: "active", reason: "Repair completed", byUserId: actorId(user), byName: actorName(user) },
          tx
        );
      }
      return { repair: updated, machineId: machine.machineId, backToWork: back };
    });
    if (backToWork) await EquipmentMachines.setState(machineId, "idle");
    return toRepairView(repair);
  } catch (error) {
    throw toCustomException(error);
  }
};

// One period per repair. Length is the recorded downtime, else the days between the dates,
// else (still open) the time so far. Hours are rounded to a tenth.
export const downtimeOf = (repair: IRepair, now: Date) => {
  const from = new Date(repair.reportedOn.getTime());
  let minutes: number;
  if (repair.downtimeMinutes !== null) minutes = repair.downtimeMinutes;
  else if (repair.resolvedOn) minutes = Math.max(0, Math.round((repair.resolvedOn.getTime() - from.getTime()) / MS_PER_MINUTE));
  else minutes = Math.max(0, Math.round((now.getTime() - from.getTime()) / MS_PER_MINUTE));
  const ongoing = repair.resolvedOn === null && repair.downtimeMinutes === null;
  return { from, to: ongoing ? null : new Date(from.getTime() + minutes * MS_PER_MINUTE), minutes };
};

const downtime = async (id: string, scope: StoreScope, query: Record<string, unknown>) => {
  try {
    const today = businessToday();
    const toRaw = queryString(query.to, "to");
    const fromRaw = queryString(query.from, "from");
    const to = toRaw === undefined ? today : parseDate(toRaw, "to");
    const from = fromRaw === undefined ? addDays(to, -DEFAULT_DOWNTIME_DAYS) : parseDate(fromRaw, "from");
    if (from > to) throw new CustomException("from cannot be after to.", badRequest);
    if ((to.getTime() - from.getTime()) / MS_PER_DAY > MAX_DOWNTIME_RANGE_DAYS) {
      throw new CustomException("The range is too long.", badRequest);
    }
    await visible(id, scope);
    const repairs = await EquipmentRecordsQuery.listRepairsOverlapping(id, from, to, MAX_DOWNTIME_PERIODS);
    const now = clock.now();
    const periods = repairs.map((r) => ({ repair: r, ...downtimeOf(r, now) }));
    const totalMinutes = periods.reduce((sum, p) => sum + p.minutes, 0);
    return {
      totalHours: Math.round((totalMinutes / 60) * 10) / 10,
      incidents: periods.length,
      periods: periods.map((p) => ({
        from: p.from.toISOString(),
        to: p.to ? p.to.toISOString() : null,
        reason: p.repair.issue,
        ongoing: p.to === null,
      })),
    };
  } catch (error) {
    throw toCustomException(error);
  }
};

export const EquipmentRecordsService = { recordInspection, listInspections, createRepair, listRepairs, updateRepair, downtime };
