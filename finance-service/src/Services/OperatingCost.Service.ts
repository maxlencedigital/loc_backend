import { CustomException } from "../../commons/Exception/CustomException.js";
import { toCustomException } from "../../commons/Exception/ToCustomException.js";
import { Page, PageRequest, toPage } from "../../commons/Utils/Pagination.js";
import { requireFields } from "../../commons/Utils/Validation.js";
import { badRequest, notFound } from "../../commons/Utils/StatusCode.js";
import { Actor, effectiveStore } from "../Middleware/StoreScope.js";
import {
  CostFrequency,
  IOperatingCost,
  IOperatingCostUpdate,
  OperatingCostType,
} from "../Models/Expense/Expense.Interface.js";
import { OperatingCostQuery } from "../Queries/OperatingCost.Query.js";
import { optionalDay, parseDay, parseMonth } from "../Utils/Dates.js";
import {
  oneOf,
  optionalUuidField,
  parseBody,
  pathId,
  queryEnum,
  queryString,
  queryUuid,
  text,
  uuidField,
  wholeNumber,
} from "../Utils/Input.js";
import { rupeesToPaise, toRupees } from "../Utils/Money.js";
import { chargesForMonth, sumBy } from "./Costing.js";

const TYPES: readonly OperatingCostType[] = [
  "rent",
  "electricity",
  "water",
  "internet",
  "salary",
  "insurance",
  "maintenance",
  "other",
];
const FREQUENCIES: readonly CostFrequency[] = ["monthly", "quarterly", "yearly"];

const toCost = (cost: IOperatingCost) => ({
  id: cost.id,
  name: cost.name,
  type: cost.type,
  amount: toRupees(cost.amountPaise),
  frequency: cost.frequency,
  storeId: cost.storeId,
  dueDay: cost.dueDay,
  startDate: cost.startDate,
  endDate: cost.endDate,
  vendorId: cost.vendorId,
  createdAt: cost.createdAt,
  updatedAt: cost.updatedAt,
});

const notFoundCost = () => new CustomException("Operating cost not found.", notFound);

const checkOrder = (startDate: string, endDate: string | null) => {
  if (endDate && endDate < startDate) throw new CustomException("endDate must not be before startDate.", badRequest);
};

const listOperatingCosts = async (
  query: Record<string, unknown>,
  actor: Actor,
  page: PageRequest
): Promise<Page<ReturnType<typeof toCost>>> => {
  try {
    const storeId = effectiveStore(actor, queryUuid(query.storeId, "storeId")) ?? undefined;
    const { items, total } = await OperatingCostQuery.search({ storeId, type: queryEnum(query.type, TYPES, "type") }, page);
    return toPage(items.map(toCost), total, page);
  } catch (error) {
    throw toCustomException(error);
  }
};

const getOperatingCost = async (rawId: string) => {
  try {
    const cost = await OperatingCostQuery.findById(pathId(rawId, "Operating cost"));
    if (!cost) throw notFoundCost();
    return toCost(cost);
  } catch (error) {
    throw toCustomException(error);
  }
};

const createOperatingCost = async (input: unknown) => {
  try {
    const body = parseBody(input);
    requireFields(body, ["name", "type", "amount", "frequency", "startDate"]);
    const startDate = parseDay(body.startDate, "startDate");
    const endDate = optionalDay(body.endDate, "endDate") ?? null;
    checkOrder(startDate, endDate);
    const cost = await OperatingCostQuery.create({
      name: text(body.name, "name", 120),
      type: oneOf(body.type, TYPES, "type"),
      amountPaise: rupeesToPaise(body.amount, "amount"),
      frequency: oneOf(body.frequency, FREQUENCIES, "frequency"),
      storeId: optionalUuidField(body.storeId, "storeId") ?? null,
      dueDay: body.dueDay === undefined || body.dueDay === null ? null : wholeNumber(body.dueDay, "dueDay", 1, 28),
      startDate,
      endDate,
      vendorId: optionalUuidField(body.vendorId, "vendorId") ?? null,
    });
    return toCost(cost);
  } catch (error) {
    throw toCustomException(error);
  }
};

const updateOperatingCost = async (rawId: string, input: unknown) => {
  try {
    const id = pathId(rawId, "Operating cost");
    const body = parseBody(input);
    const current = await OperatingCostQuery.findById(id);
    if (!current) throw notFoundCost();

    // Only these fields can change; req.body is never spread into the write.
    const edits: IOperatingCostUpdate = {};
    if (body.name !== undefined) edits.name = text(body.name, "name", 120);
    if (body.type !== undefined) edits.type = oneOf(body.type, TYPES, "type");
    if (body.amount !== undefined) edits.amountPaise = rupeesToPaise(body.amount, "amount");
    if (body.frequency !== undefined) edits.frequency = oneOf(body.frequency, FREQUENCIES, "frequency");
    if (body.storeId !== undefined) edits.storeId = body.storeId === null ? null : uuidField(body.storeId, "storeId");
    if (body.dueDay !== undefined) edits.dueDay = body.dueDay === null ? null : wholeNumber(body.dueDay, "dueDay", 1, 28);
    if (body.startDate !== undefined) edits.startDate = parseDay(body.startDate, "startDate");
    if (body.endDate !== undefined) edits.endDate = body.endDate === null ? null : parseDay(body.endDate, "endDate");
    if (body.vendorId !== undefined) edits.vendorId = body.vendorId === null ? null : uuidField(body.vendorId, "vendorId");
    if (Object.keys(edits).length === 0) throw new CustomException("Nothing to update.", badRequest);
    checkOrder(edits.startDate ?? current.startDate, edits.endDate === undefined ? current.endDate : edits.endDate);

    const updated = await OperatingCostQuery.update(id, edits);
    if (!updated) throw notFoundCost();
    return toCost(updated);
  } catch (error) {
    throw toCustomException(error);
  }
};

// A deleted cost drops out of every month, past ones included. To stop a cost going forward
// while keeping history, set its endDate instead.
const deleteOperatingCost = async (rawId: string) => {
  try {
    const id = pathId(rawId, "Operating cost");
    if (!(await OperatingCostQuery.softDelete(id))) throw notFoundCost();
    return { id, deleted: true };
  } catch (error) {
    throw toCustomException(error);
  }
};

const getMonthlyOperatingCost = async (query: Record<string, unknown>, actor: Actor) => {
  try {
    const month = parseMonth(queryString(query.month, "month"), "month");
    const storeId = effectiveStore(actor, queryUuid(query.storeId, "storeId")) ?? undefined;
    const charges = await chargesForMonth(month, storeId);
    const byType = [...sumBy(charges, (c) => c.type)].sort((a, b) => b[1] - a[1]);
    const byStore = [...sumBy(charges, (c) => c.storeId)].sort((a, b) => b[1] - a[1]);
    return {
      month,
      total: toRupees(charges.reduce((sum, c) => sum + c.amountPaise, 0)),
      byType: byType.map(([type, paise]) => ({ type, amount: toRupees(paise) })),
      byStore: byStore.map(([store, paise]) => ({ storeId: store, amount: toRupees(paise) })),
    };
  } catch (error) {
    throw toCustomException(error);
  }
};

export const OperatingCostService = {
  listOperatingCosts,
  getOperatingCost,
  createOperatingCost,
  updateOperatingCost,
  deleteOperatingCost,
  getMonthlyOperatingCost,
};
