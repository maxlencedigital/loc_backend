import { CustomException } from "../../commons/Exception/CustomException.js";
import { toCustomException } from "../../commons/Exception/ToCustomException.js";
import { parsePage, toPage } from "../../commons/Utils/Pagination.js";
import { badRequest, conflict, notFound } from "../../commons/Utils/StatusCode.js";
import type { RequestUser } from "../Middleware/Identity.js";
import {
  DEVICE_CONDITIONS,
  DEVICE_PATCH_TRANSITIONS,
  DEVICE_STATUSES,
  DEVICE_TYPES,
  IDevice,
  IDeviceEvent,
  IDeviceRepair,
  IDeviceUpdate,
} from "../Models/It/It.Interface.js";
import { isUniqueViolation } from "../Queries/DatabaseError.js";
import { ItDeviceQuery } from "../Queries/ItDevice.Query.js";
import { businessToday, dateOut, notInFuture, parseDate, timeOut } from "../Utils/AssetDates.js";
import { actorId, actorName, amountToPaise, patchDate, patchText, queryUuid, requireChange, uuidField } from "../Utils/AssetInput.js";
import { oneOf, optionalOneOf, optionalText, parseBody, queryString, text } from "../Utils/Input.js";
import { toRupees } from "../Utils/Money.js";
import { isUuid } from "../Utils/Uuid.js";

const NOT_FOUND = "Device not found.";
const TAG_PATTERN = /^[A-Z0-9][A-Z0-9-]{1,39}$/;
const HISTORY_LIMIT = 50;

export const toDeviceView = (d: IDevice) => ({
  id: d.id,
  assetTag: d.assetTag,
  type: d.type,
  make: d.make,
  model: d.model,
  serialNumber: d.serialNumber,
  purchasedOn: dateOut(d.purchasedOn),
  warrantyUntil: dateOut(d.warrantyUntil),
  condition: d.condition,
  status: d.status,
  assignedToEmployeeId: d.assignedToEmployeeId,
  assignedAt: timeOut(d.assignedAt),
  createdAt: d.createdAt.toISOString(),
  updatedAt: d.updatedAt.toISOString(),
});

const toEventView = (e: IDeviceEvent) => ({
  at: e.at.toISOString(),
  kind: e.kind,
  from: e.fromStatus,
  to: e.toStatus,
  employeeId: e.employeeId,
  condition: e.condition,
  note: e.note,
  by: e.byName,
});

const toRepairView = (r: IDeviceRepair) => ({
  id: r.id,
  issue: r.issue,
  cost: r.costPaise === null ? null : toRupees(r.costPaise),
  repairedOn: dateOut(r.repairedOn),
});

const parseTag = (value: unknown): string => {
  const tag = text(value, "assetTag", 40).toUpperCase();
  if (!TAG_PATTERN.test(tag)) {
    throw new CustomException("assetTag must be 2 to 40 letters, digits or dashes, e.g. LT-0042.", badRequest);
  }
  return tag;
};

const duplicateTag = (error: unknown): never => {
  if (isUniqueViolation(error, "assetTag")) throw new CustomException("A device with this asset tag already exists.", conflict);
  throw error;
};

const list = async (query: Record<string, unknown>) => {
  try {
    const page = parsePage(query);
    const result = await ItDeviceQuery.search(
      {
        type: optionalOneOf(queryString(query.type, "type"), DEVICE_TYPES, "type"),
        status: optionalOneOf(queryString(query.status, "status"), DEVICE_STATUSES, "status"),
        assignedTo: queryUuid(query.assignedTo, "assignedTo"),
      },
      page
    );
    return toPage(result.items.map(toDeviceView), result.total, page);
  } catch (error) {
    throw toCustomException(error);
  }
};

const getById = async (id: string) => {
  try {
    const device = isUuid(id) ? await ItDeviceQuery.findById(id) : null;
    if (!device) throw new CustomException(NOT_FOUND, notFound);
    return { ...toDeviceView(device), history: (await ItDeviceQuery.listEvents(id, HISTORY_LIMIT)).map(toEventView) };
  } catch (error) {
    throw toCustomException(error);
  }
};

const create = async (user: RequestUser, input: unknown) => {
  try {
    const body = parseBody(input);
    const status = optionalOneOf(body.status, DEVICE_STATUSES, "status") ?? "in_stock";
    if (status === "assigned" || status === "retired") {
      throw new CustomException("A new device is registered in stock or in repair; use assign to give it to someone.", badRequest);
    }
    const data = {
      assetTag: parseTag(body.assetTag),
      type: oneOf(body.type, DEVICE_TYPES, "type"),
      make: optionalText(body.make, "make", 80) ?? null,
      model: optionalText(body.model, "model", 80) ?? null,
      serialNumber: optionalText(body.serialNumber, "serialNumber", 80) ?? null,
      purchasedOn: body.purchasedOn === undefined || body.purchasedOn === null ? null : notInFuture(parseDate(body.purchasedOn, "purchasedOn"), "purchasedOn"),
      warrantyUntil: body.warrantyUntil === undefined || body.warrantyUntil === null ? null : parseDate(body.warrantyUntil, "warrantyUntil"),
      condition: optionalOneOf(body.condition, DEVICE_CONDITIONS, "condition") ?? "good",
      status,
    };
    const event = { kind: "registered" as const, fromStatus: null, toStatus: status, employeeId: null, condition: data.condition, note: null, byUserId: actorId(user), byName: actorName(user) };
    try {
      return toDeviceView(await ItDeviceQuery.create(data, event));
    } catch (error) {
      return duplicateTag(error);
    }
  } catch (error) {
    throw toCustomException(error);
  }
};

const update = async (id: string, user: RequestUser, input: unknown) => {
  try {
    if (!isUuid(id)) throw new CustomException(NOT_FOUND, notFound);
    const body = parseBody(input);
    const data: IDeviceUpdate = {};
    if (body.assetTag !== undefined) data.assetTag = parseTag(body.assetTag);
    if (body.type !== undefined) data.type = oneOf(body.type, DEVICE_TYPES, "type");
    const make = patchText(body.make, "make", 80);
    if (make !== undefined) data.make = make;
    const model = patchText(body.model, "model", 80);
    if (model !== undefined) data.model = model;
    const serial = patchText(body.serialNumber, "serialNumber", 80);
    if (serial !== undefined) data.serialNumber = serial;
    const purchasedOn = patchDate(body.purchasedOn, "purchasedOn");
    if (purchasedOn !== undefined) data.purchasedOn = purchasedOn === null ? null : notInFuture(purchasedOn, "purchasedOn");
    const warranty = patchDate(body.warrantyUntil, "warrantyUntil");
    if (warranty !== undefined) data.warrantyUntil = warranty;
    if (body.condition !== undefined) data.condition = oneOf(body.condition, DEVICE_CONDITIONS, "condition");
    const target = body.status === undefined ? undefined : oneOf(body.status, DEVICE_STATUSES, "status");
    if (target === "assigned") throw new CustomException("Use assign to give a device to someone.", badRequest);
    if (target) data.status = target;
    requireChange(data);

    const updated = await ItDeviceQuery.inTransaction(async (tx) => {
      const current = await ItDeviceQuery.lockById(id, tx);
      if (!current) throw new CustomException(NOT_FOUND, notFound);
      if (current.status === "retired") throw new CustomException("A retired device cannot be changed.", conflict);
      const moves = target !== undefined && target !== current.status;
      if (moves && !DEVICE_PATCH_TRANSITIONS[current.status].includes(target)) {
        const hint = current.status === "assigned" ? " Take it back with return first." : "";
        throw new CustomException(`A device cannot move from ${current.status} to ${target}.${hint}`, conflict);
      }
      if (!moves) delete data.status;
      const event = moves
        ? { kind: "status_changed" as const, fromStatus: current.status, toStatus: target, employeeId: null, condition: null, note: null, byUserId: actorId(user), byName: actorName(user) }
        : null;
      return await ItDeviceQuery.update(id, data, event, tx);
    });
    return toDeviceView(updated);
  } catch (error) {
    return duplicateTagOrRethrow(error);
  }
};

const duplicateTagOrRethrow = (error: unknown): never => {
  if (isUniqueViolation(error, "assetTag")) throw new CustomException("A device with this asset tag already exists.", conflict);
  throw toCustomException(error);
};

// The row lock makes "is it in stock?" and "give it away" one step: of two simultaneous
// assignments the second finds the device already assigned.
const assign = async (id: string, user: RequestUser, input: unknown) => {
  try {
    const body = parseBody(input);
    const employeeId = uuidField(body.employeeId, "employeeId");
    const note = optionalText(body.note, "note", 500) ?? null;
    if (!isUuid(id)) throw new CustomException(NOT_FOUND, notFound);
    const assigned = await ItDeviceQuery.inTransaction(async (tx) => {
      const device = await ItDeviceQuery.lockById(id, tx);
      if (!device) throw new CustomException(NOT_FOUND, notFound);
      if (device.status !== "in_stock") {
        throw new CustomException(
          device.status === "assigned" ? "This device is already assigned. Take it back first." : `A device that is ${device.status.replace("_", " ")} cannot be assigned.`,
          conflict
        );
      }
      return await ItDeviceQuery.update(
        id,
        { status: "assigned", assignedToEmployeeId: employeeId, assignedAt: new Date() },
        { kind: "assigned", fromStatus: "in_stock", toStatus: "assigned", employeeId, condition: null, note, byUserId: actorId(user), byName: actorName(user) },
        tx
      );
    });
    return toDeviceView(assigned);
  } catch (error) {
    throw toCustomException(error);
  }
};

const returnDevice = async (id: string, user: RequestUser, input: unknown) => {
  try {
    const body = parseBody(input);
    const condition = optionalOneOf(body.condition, DEVICE_CONDITIONS, "condition");
    const note = optionalText(body.note, "note", 500) ?? null;
    if (!isUuid(id)) throw new CustomException(NOT_FOUND, notFound);
    const back = await ItDeviceQuery.inTransaction(async (tx) => {
      const device = await ItDeviceQuery.lockById(id, tx);
      if (!device) throw new CustomException(NOT_FOUND, notFound);
      if (device.status !== "assigned") throw new CustomException("This device is not assigned to anyone.", conflict);
      return await ItDeviceQuery.update(
        id,
        { status: "in_stock", assignedToEmployeeId: null, assignedAt: null, ...(condition ? { condition } : {}) },
        { kind: "returned", fromStatus: "assigned", toStatus: "in_stock", employeeId: device.assignedToEmployeeId, condition: condition ?? device.condition, note, byUserId: actorId(user), byName: actorName(user) },
        tx
      );
    });
    return toDeviceView(back);
  } catch (error) {
    throw toCustomException(error);
  }
};

const createRepair = async (id: string, user: RequestUser, input: unknown) => {
  try {
    const body = parseBody(input);
    const data = {
      issue: text(body.issue, "issue", 500),
      costPaise: body.cost === undefined || body.cost === null ? null : amountToPaise(body.cost, "cost"),
      repairedOn: body.repairedOn === undefined || body.repairedOn === null ? businessToday() : notInFuture(parseDate(body.repairedOn, "repairedOn"), "repairedOn"),
      createdByUserId: actorId(user),
    };
    const device = isUuid(id) ? await ItDeviceQuery.findById(id) : null;
    if (!device) throw new CustomException(NOT_FOUND, notFound);
    if (device.status === "retired") throw new CustomException("A retired device cannot have new repairs.", conflict);
    return toRepairView(await ItDeviceQuery.createRepair(id, data));
  } catch (error) {
    throw toCustomException(error);
  }
};

const listRepairs = async (id: string, query: Record<string, unknown>) => {
  try {
    const page = parsePage(query);
    if (!isUuid(id) || !(await ItDeviceQuery.exists(id))) throw new CustomException(NOT_FOUND, notFound);
    const result = await ItDeviceQuery.listRepairs(id, page);
    return toPage(result.items.map(toRepairView), result.total, page);
  } catch (error) {
    throw toCustomException(error);
  }
};

export const ItDeviceService = { list, getById, create, update, assign, returnDevice, createRepair, listRepairs };
