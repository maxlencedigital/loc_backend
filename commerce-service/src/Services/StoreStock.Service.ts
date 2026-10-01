import { CustomException } from "../../commons/Exception/CustomException.js";
import { toCustomException } from "../../commons/Exception/ToCustomException.js";
import { parsePage } from "../../commons/Utils/Pagination.js";
import { badRequest, conflict, notFound } from "../../commons/Utils/StatusCode.js";
import type { RequestUser } from "../Middleware/Identity.js";
import type { StoreScope } from "../Middleware/StoreScope.js";
import {
  IStockAlertRow,
  MOVEMENT_KINDS,
  MovementKind,
  STOCK_FLAG_LEVELS,
  StockFlagLevel,
  StockLevel,
} from "../Models/StoreAdmin/StoreAdmin.Interface.js";
import { isUniqueViolation } from "../Queries/DatabaseError.js";
import { StoreQuery } from "../Queries/Store.Query.js";
import { StoreStockQuery } from "../Queries/StoreStock.Query.js";
import { oneOf, optionalText, parseBody, queryString, text } from "../Utils/Input.js";
import { milliToUnits, toMilli } from "../Utils/StoreAdminInput.js";
import { isUuid } from "../Utils/Uuid.js";
import { actorNameOf, requireStore } from "./StoreAccess.js";

const ITEM_NOT_FOUND = "Stock item not found.";
// A thousand tonnes of anything is a typo; the quantity column is a 32-bit count of thousandths.
const MAX_MOVEMENT_MILLI = 1_000_000_000;
const SEVERITY: Record<StockLevel, number> = { ok: 0, low: 1, critical: 2, out: 3 };

/** out: none left. critical: half the reorder level or less. low: at or below it. */
export const stockLevel = (quantityMilli: number, reorderLevelMilli: number): StockLevel => {
  if (quantityMilli <= 0) return "out";
  if (reorderLevelMilli > 0 && quantityMilli * 2 <= reorderLevelMilli) return "critical";
  return quantityMilli <= reorderLevelMilli ? "low" : "ok";
};

const toItemView = (row: IStockAlertRow) => ({
  id: row.id,
  name: row.name,
  category: row.category,
  unit: row.unit,
  quantity: milliToUnits(row.quantityMilli),
  reorderLevel: milliToUnits(row.reorderLevelMilli),
  status: stockLevel(row.quantityMilli, row.reorderLevelMilli),
});

// The worse of what the numbers say and what the floor flagged.
export const alertLevel = (row: IStockAlertRow): StockFlagLevel | null => {
  const derived = stockLevel(row.quantityMilli, row.reorderLevelMilli);
  const flagged: StockLevel = row.flagLevel ?? "ok";
  const worst = SEVERITY[flagged] > SEVERITY[derived] ? flagged : derived;
  return worst === "ok" ? null : worst;
};

const toAlertView = (row: IStockAlertRow) => ({
  // One open alert per material, so the material id is the alert id.
  id: row.id,
  itemId: row.id,
  name: row.name,
  level: alertLevel(row),
  raisedBy: row.flagRaisedBy ?? "system",
  raisedAt: (row.flagRaisedAt ?? row.updatedAt).toISOString(),
  note: row.flagNote,
});

const parseFlag = (value: unknown, field: string): boolean | undefined => {
  const raw = queryString(value, field);
  if (raw === undefined) return undefined;
  if (raw !== "true" && raw !== "false") throw new CustomException(`${field} must be true or false.`, badRequest);
  return raw === "true";
};

const listStoreStock = async (scope: StoreScope, storeId: string, query: Record<string, unknown>) => {
  try {
    const page = parsePage(query);
    const category = queryString(query.category, "category");
    const lowOnly = parseFlag(query.lowOnly, "lowOnly") ?? false;
    await requireStore(storeId, scope);

    const base = { storeId, category, lowOnly };
    const result = await StoreStockQuery.select({ ...base, offset: page.offset, limit: page.limit });
    const total = result.rows.length === 0 && page.offset > 0 ? await StoreStockQuery.count(base) : result.total;
    return { items: result.rows.map(toItemView), page: page.page, limit: page.limit, total };
  } catch (error) {
    throw toCustomException(error);
  }
};

const listStockAlerts = async (scope: StoreScope, storeId: string, query: Record<string, unknown>) => {
  try {
    const page = parsePage(query);
    await requireStore(storeId, scope);

    const base = { storeId, alertsOnly: true, newestAlertFirst: true };
    const result = await StoreStockQuery.select({ ...base, offset: page.offset, limit: page.limit });
    const total = result.rows.length === 0 && page.offset > 0 ? await StoreStockQuery.count(base) : result.total;
    return { alerts: result.rows.map(toAlertView), page: page.page, limit: page.limit, total };
  } catch (error) {
    throw toCustomException(error);
  }
};

const findItem = async (storeId: string, itemId: string): Promise<IStockAlertRow> => {
  const row = isUuid(itemId) ? (await StoreStockQuery.select({ storeId, itemId, offset: 0, limit: 1 })).rows[0] : undefined;
  if (!row) throw new CustomException(ITEM_NOT_FOUND, notFound);
  return row;
};

const getStoreStockItem = async (scope: StoreScope, storeId: string, itemId: string) => {
  try {
    await requireStore(storeId, scope);
    const row = await findItem(storeId, itemId);
    return { ...toItemView(row), flag: row.flagLevel ? toAlertView(row) : null };
  } catch (error) {
    throw toCustomException(error);
  }
};

const flagLowStock = async (scope: StoreScope, user: RequestUser, storeId: string, itemId: string, input: unknown) => {
  try {
    const body = parseBody(input);
    const level = oneOf(body.level, STOCK_FLAG_LEVELS, "level");
    const note = optionalText(body.note, "note", 300) ?? null;
    await requireStore(storeId, scope);
    await findItem(storeId, itemId);

    await StoreStockQuery.upsertFlag({ storeId, itemId, level, note, byUserId: user.id, byName: actorNameOf(user) });
    return toAlertView(await findItem(storeId, itemId));
  } catch (error) {
    throw toCustomException(error);
  }
};

const KIND_LABEL: Record<MovementKind, string> = {
  consumption: "Used",
  receipt: "Received",
  correction: "Corrected",
};

// Called by other services (internal route): there is no user, so the caller names the actor.
// Increases and decreases are one atomic change plus a ledger row; a retry with the same key
// returns the first result instead of moving the stock twice.
const recordMovement = async (storeId: string, itemId: string, input: unknown) => {
  try {
    const body = parseBody(input);
    const kind = oneOf(body.kind, MOVEMENT_KINDS, "kind");
    const quantityMilli = toMilli(body.quantity, "quantity", MAX_MOVEMENT_MILLI);
    const direction =
      kind === "correction" ? oneOf(body.direction, ["increase", "decrease"] as const, "direction") : undefined;
    const reason = kind === "correction" ? text(body.reason, "reason", 200) : optionalText(body.reason, "reason", 200) ?? null;
    const actor = parseBody(body.actor);
    const byName = text(actor.name, "actor.name", 80);
    const byUserId = actor.id === undefined || actor.id === null ? null : text(actor.id, "actor.id", 80);
    const idempotencyKey = optionalText(body.idempotencyKey, "idempotencyKey", 80) ?? null;
    const deltaMilli = kind === "consumption" || direction === "decrease" ? -quantityMilli : quantityMilli;

    if (!isUuid(storeId) || !(await StoreQuery.findById(storeId, null))) throw new CustomException("Store not found.", notFound);
    if (!isUuid(itemId) || !(await StoreStockQuery.findMaterial(itemId))) throw new CustomException(ITEM_NOT_FOUND, notFound);

    const write = { storeId, itemId, kind, deltaMilli, reason, byUserId, byName, idempotencyKey };
    const view = (movement: { id: string; kind: MovementKind; deltaMilli: number; quantityAfterMilli: number; createdAt: Date }) => ({
      id: movement.id,
      itemId,
      kind: movement.kind,
      change: milliToUnits(movement.deltaMilli),
      quantity: milliToUnits(movement.quantityAfterMilli),
      at: movement.createdAt.toISOString(),
    });

    if (idempotencyKey) {
      const first = await StoreStockQuery.findMovementByKey(storeId, itemId, idempotencyKey);
      if (first) return view(first);
    }
    try {
      const movement = await StoreStockQuery.inTransaction((tx) => StoreStockQuery.applyMovement(write, tx));
      if (!movement) {
        throw new CustomException(`${KIND_LABEL[kind]} quantity is more than the stock on hand.`, conflict);
      }
      return view(movement);
    } catch (error) {
      if (idempotencyKey && isUniqueViolation(error, "stock_movement")) {
        const first = await StoreStockQuery.findMovementByKey(storeId, itemId, idempotencyKey);
        if (first) return view(first);
      }
      throw error;
    }
  } catch (error) {
    throw toCustomException(error);
  }
};

export const StoreStockService = { listStoreStock, listStockAlerts, getStoreStockItem, flagLowStock, recordMovement };
