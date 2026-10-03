import { CustomException } from "../../commons/Exception/CustomException.js";
import { toCustomException } from "../../commons/Exception/ToCustomException.js";
import { parsePage, toPage } from "../../commons/Utils/Pagination.js";
import { badRequest, conflict } from "../../commons/Utils/StatusCode.js";
import type { RequestUser } from "../Middleware/Identity.js";
import { StoreScope } from "../Middleware/StoreScope.js";
import {
  IItemWrite,
  IPurchaseOrder,
  IPurchaseOrderSummary,
  OUTSTANDING_STATUSES,
  PURCHASE_ORDER_STATUSES,
  PURCHASE_ORDER_TRANSITIONS,
  PurchaseOrderStatus,
} from "../Models/OpsVendors/PurchaseOrder.Interface.js";
import { isUniqueViolation } from "../Queries/DatabaseError.js";
import { OpsMaterialQuery } from "../Queries/OpsMaterial.Query.js";
import { OpsPurchaseOrderQuery } from "../Queries/OpsPurchaseOrder.Query.js";
import { OpsVendorQuery } from "../Queries/OpsVendor.Query.js";
import { StoreQuery } from "../Queries/Store.Query.js";
import { optionalOneOf, parseBody, queryString } from "../Utils/Input.js";
import { rupeesToPaise, toRupees } from "../Utils/Money.js";
import { istDateOf, optionalDateInput, todayIst } from "../Utils/OpsDates.js";
import {
  MAX_BODY_ITEMS,
  milliToQuantity,
  nullableText,
  optionalUuid,
  parseIdempotencyKey,
  queryBoolean,
  quantityToMilli,
  requiredUuid,
} from "../Utils/OpsInput.js";
import { isUuid } from "../Utils/Uuid.js";
import { IActor, actorOf, assertStoreInScope, listStore, notFoundError, parseRange } from "./OpsActor.js";

const NOT_FOUND = "Purchase order";
const MAX_QUANTITY_MILLI = 10_000_000;
const MAX_UNIT_PRICE_PAISE = 100_000_000;
// Keeps every total inside a 4-byte integer of paise (about 2.1 crore rupees).
const MAX_ORDER_TOTAL_PAISE = 2_000_000_000;
const MAX_REPORT_MATERIALS = 500;
const MAX_REPORT_STORES = 200;
// Suggested order: top the store back up to twice its reorder level.
const TARGET_LEVEL_FACTOR = 2;

// Line value for a (possibly partial) quantity. Receipts compare cumulative values, so a
// fully received line is exactly its ordered amount whatever the delivery split.
const lineValue = (unitPricePaise: number | null, quantityMilli: number): number =>
  unitPricePaise === null ? 0 : Math.round((unitPricePaise * quantityMilli) / 1000);

export const toPurchaseOrderView = (order: IPurchaseOrder) => ({
  id: order.id,
  number: order.number,
  vendorId: order.vendorId,
  vendorName: order.vendorName,
  storeId: order.storeId,
  status: order.status,
  total: toRupees(order.totalPaise),
  received: toRupees(order.receivedValuePaise),
  outstanding: OUTSTANDING_STATUSES.includes(order.status) ? toRupees(order.totalPaise - order.receivedValuePaise) : 0,
  expectedOn: order.expectedOn,
  notes: order.notes,
  sentAt: order.sentAt?.toISOString() ?? null,
  receivedAt: order.receivedAt?.toISOString() ?? null,
  deliveredOnTime: order.deliveredOnTime,
  cancelledAt: order.cancelledAt?.toISOString() ?? null,
  cancelReason: order.cancelReason,
  createdAt: order.createdAt.toISOString(),
  items: order.items.map((item) => ({
    id: item.id,
    materialId: item.materialId,
    materialName: item.materialName,
    unit: item.unit,
    quantity: milliToQuantity(item.quantityMilli),
    receivedQty: milliToQuantity(item.receivedMilli),
    unitPrice: item.unitPricePaise === null ? null : toRupees(item.unitPricePaise),
    amount: toRupees(item.amountPaise),
  })),
  receipts: order.receipts.map((r) => ({
    id: r.id,
    invoiceRef: r.invoiceRef,
    note: r.note,
    receivedAt: r.receivedAt.toISOString(),
    receivedBy: r.byName,
    items: r.lines.map((l) => ({ materialId: l.materialId, receivedQty: milliToQuantity(l.quantityMilli) })),
  })),
  timeline: order.events.map((e) => ({
    at: e.at.toISOString(),
    from: e.fromStatus,
    status: e.toStatus,
    by: e.byName,
    ...(e.note ? { note: e.note } : {}),
  })),
});

const toSummaryView = (order: IPurchaseOrderSummary) => ({
  id: order.id,
  number: order.number,
  vendorId: order.vendorId,
  storeId: order.storeId,
  status: order.status,
  total: toRupees(order.totalPaise),
  outstanding: OUTSTANDING_STATUSES.includes(order.status) ? toRupees(order.totalPaise - order.receivedValuePaise) : 0,
  expectedOn: order.expectedOn,
  sentAt: order.sentAt?.toISOString() ?? null,
  createdAt: order.createdAt.toISOString(),
});

// Validates the lines against the material list and prices them. A line without a price is
// kept (value 0) so a draft can be saved before the vendor quotes; sending requires prices.
const buildItems = async (raw: unknown): Promise<{ items: IItemWrite[]; totalPaise: number }> => {
  if (!Array.isArray(raw) || raw.length === 0) throw new CustomException("items must be a non-empty list.", badRequest);
  if (raw.length > MAX_BODY_ITEMS) throw new CustomException(`An order holds at most ${MAX_BODY_ITEMS} lines.`, badRequest);
  const lines = raw.map((entry) => {
    const line = parseBody(entry);
    return {
      materialId: requiredUuid(line.materialId, "materialId"),
      quantityMilli: quantityToMilli(line.quantity, "quantity", MAX_QUANTITY_MILLI),
      unitPricePaise:
        line.unitPrice === undefined || line.unitPrice === null ? null : rupeesToPaise(line.unitPrice, "unitPrice", MAX_UNIT_PRICE_PAISE),
    };
  });
  const ids = lines.map((l) => l.materialId.toLowerCase());
  if (new Set(ids).size !== ids.length) throw new CustomException("A material can appear on an order only once.", badRequest);
  const materials = new Map((await OpsMaterialQuery.findByIds(ids)).map((m) => [m.id, m]));
  const items = lines.map((line) => {
    const material = materials.get(line.materialId.toLowerCase());
    if (!material) throw notFoundError("Material");
    return {
      materialId: material.id,
      materialName: material.name,
      unit: material.unit,
      quantityMilli: line.quantityMilli,
      unitPricePaise: line.unitPricePaise,
      amountPaise: lineValue(line.unitPricePaise, line.quantityMilli),
    };
  });
  const totalPaise = items.reduce((sum, item) => sum + item.amountPaise, 0);
  if (totalPaise > MAX_ORDER_TOTAL_PAISE) throw new CustomException("The order total is too large.", badRequest);
  return { items, totalPaise };
};

const parseExpectedOn = (value: unknown): string | null | undefined => {
  if (value === undefined) return undefined;
  const date = optionalDateInput(value, "expectedOn");
  if (date && date < todayIst()) throw new CustomException("expectedOn must not be in the past.", badRequest);
  return date ?? null;
};

const create = async (scope: StoreScope, user: RequestUser, input: unknown, key?: string) => {
  try {
    const body = parseBody(input);
    const idempotencyKey = parseIdempotencyKey(key);
    const vendorId = requiredUuid(body.vendorId, "vendorId");
    const storeId = requiredUuid(body.storeId, "storeId");
    const expectedOn = parseExpectedOn(body.expectedOn) ?? null;
    const notes = nullableText(body.notes, "notes", 1000) ?? null;
    const { items, totalPaise } = await buildItems(body.items);
    assertStoreInScope(scope, storeId);
    const actor = actorOf(user);

    if (idempotencyKey) {
      const earlier = await OpsPurchaseOrderQuery.findByIdempotencyKey(actor.id, idempotencyKey);
      if (earlier) return toPurchaseOrderView(earlier);
    }
    const vendor = await OpsVendorQuery.findById(vendorId);
    if (!vendor) throw notFoundError("Vendor");
    if (!vendor.isActive) throw new CustomException("This vendor is deactivated.", conflict);
    const store = await StoreQuery.findById(storeId, null);
    if (!store) throw notFoundError("Store");
    if (store.status === "closed") throw new CustomException("This store is closed.", conflict);

    try {
      const order = await OpsPurchaseOrderQuery.inTransaction(async (tx) => {
        const number = await OpsPurchaseOrderQuery.nextNumber(tx);
        return await OpsPurchaseOrderQuery.create(
          number,
          {
            vendorId,
            storeId,
            expectedOn,
            notes,
            totalPaise,
            items,
            createdBy: actor.id,
            idempotencyKey: idempotencyKey ?? null,
            firstEvent: { byUserId: actor.id, byName: actor.name },
          },
          tx
        );
      });
      return toPurchaseOrderView(order);
    } catch (error) {
      // Two simultaneous submissions of one key: the loser returns the winner's order.
      if (idempotencyKey && isUniqueViolation(error, "idempotency")) {
        const winner = await OpsPurchaseOrderQuery.findByIdempotencyKey(actor.id, idempotencyKey);
        if (winner) return toPurchaseOrderView(winner);
      }
      throw error;
    }
  } catch (error) {
    throw toCustomException(error);
  }
};

const list = async (scope: StoreScope, query: Record<string, unknown>) => {
  try {
    const page = parsePage(query);
    const status = optionalOneOf(queryString(query.status, "status"), PURCHASE_ORDER_STATUSES, "status");
    const outstanding = queryBoolean(queryString(query.outstanding, "outstanding"), "outstanding");
    const vendorId = optionalUuid(queryString(query.vendorId, "vendorId"), "vendorId");
    const store = listStore(scope, query);
    let statuses: PurchaseOrderStatus[] | undefined = status ? [status] : undefined;
    if (outstanding) statuses = (statuses ?? [...OUTSTANDING_STATUSES]).filter((s) => OUTSTANDING_STATUSES.includes(s));
    if (store.empty || statuses?.length === 0) return toPage([], 0, page);
    const { items, total } = await OpsPurchaseOrderQuery.list({
      storeId: store.storeId,
      vendorId,
      statuses,
      offset: page.offset,
      limit: page.limit,
    });
    return toPage(items.map(toSummaryView), total, page);
  } catch (error) {
    throw toCustomException(error);
  }
};

const requireOrder = async (id: string, scope: StoreScope): Promise<IPurchaseOrder> => {
  const order = isUuid(id) ? await OpsPurchaseOrderQuery.findById(id, scope) : null;
  if (!order) throw notFoundError(NOT_FOUND);
  return order;
};

const getById = async (id: string, scope: StoreScope) => {
  try {
    return toPurchaseOrderView(await requireOrder(id, scope));
  } catch (error) {
    throw toCustomException(error);
  }
};

// Called when a locked or conditional step finds the order gone from the expected status.
const staleOrder = () => new CustomException("This purchase order was changed by someone else. Reload and try again.", conflict);

const canMove = (from: PurchaseOrderStatus, to: PurchaseOrderStatus): boolean => PURCHASE_ORDER_TRANSITIONS[from].includes(to);

const updateDraft = async (id: string, scope: StoreScope, input: unknown) => {
  try {
    const body = parseBody(input);
    const expectedOn = parseExpectedOn(body.expectedOn);
    const notes = nullableText(body.notes, "notes", 1000);
    const built = body.items === undefined ? undefined : await buildItems(body.items);
    await requireOrder(id, scope);

    await OpsPurchaseOrderQuery.inTransaction(async (tx) => {
      if (!(await OpsPurchaseOrderQuery.lockInStatus(id, scope, ["draft"], tx))) {
        if (!(await OpsPurchaseOrderQuery.findById(id, scope, tx))) throw notFoundError(NOT_FOUND);
        throw new CustomException("Only a draft can be edited.", conflict);
      }
      const order = await OpsPurchaseOrderQuery.findById(id, scope, tx);
      if (!order) throw notFoundError(NOT_FOUND);
      await OpsPurchaseOrderQuery.updateDraft(
        id,
        order.storeId,
        { expectedOn, notes, items: built?.items, totalPaise: built?.totalPaise },
        tx
      );
    });
    return toPurchaseOrderView(await requireOrder(id, scope));
  } catch (error) {
    throw toCustomException(error);
  }
};

const move = async (
  id: string,
  scope: StoreScope,
  actor: IActor,
  to: PurchaseOrderStatus,
  data: { sentAt?: Date; cancelledAt?: Date; cancelReason?: string | null },
  note: string | null,
  check?: (order: IPurchaseOrder) => Promise<void>
) => {
  const order = await requireOrder(id, scope);
  if (!canMove(order.status, to)) {
    const label = order.status.replace("_", " ");
    throw new CustomException(
      to === "sent" ? "Only a draft can be sent." : `A ${label} purchase order cannot be cancelled.`,
      conflict
    );
  }
  if (check) await check(order);
  const moved = await OpsPurchaseOrderQuery.inTransaction((tx) =>
    OpsPurchaseOrderQuery.transition(
      id,
      order.status,
      { status: to, ...data },
      { fromStatus: order.status, toStatus: to, note, byUserId: actor.id, byName: actor.name },
      tx
    )
  );
  if (!moved) throw staleOrder();
  return toPurchaseOrderView(await requireOrder(id, scope));
};

const send = async (id: string, scope: StoreScope, user: RequestUser) => {
  try {
    return await move(id, scope, actorOf(user), "sent", { sentAt: new Date() }, null, async (order) => {
      if (order.items.some((item) => item.unitPricePaise === null)) {
        throw new CustomException("Every line needs a unit price before the order is sent.", conflict);
      }
      const vendor = await OpsVendorQuery.findById(order.vendorId);
      if (!vendor?.isActive) throw new CustomException("This vendor is deactivated.", conflict);
    });
  } catch (error) {
    throw toCustomException(error);
  }
};

const cancel = async (id: string, scope: StoreScope, user: RequestUser, input: unknown) => {
  try {
    const reason = nullableText(parseBody(input).reason, "reason", 500) ?? null;
    return await move(id, scope, actorOf(user), "cancelled", { cancelledAt: new Date(), cancelReason: reason }, reason);
  } catch (error) {
    throw toCustomException(error);
  }
};

const receive = async (id: string, scope: StoreScope, user: RequestUser, input: unknown) => {
  try {
    const body = parseBody(input);
    if (!Array.isArray(body.items) || body.items.length === 0) throw new CustomException("items must be a non-empty list.", badRequest);
    if (body.items.length > MAX_BODY_ITEMS) throw new CustomException(`At most ${MAX_BODY_ITEMS} lines can be received at once.`, badRequest);
    const lines = body.items.map((entry: unknown) => {
      const line = parseBody(entry);
      return {
        materialId: requiredUuid(line.materialId, "materialId").toLowerCase(),
        quantityMilli: quantityToMilli(line.receivedQty, "receivedQty", MAX_QUANTITY_MILLI),
      };
    });
    if (new Set(lines.map((l: { materialId: string }) => l.materialId)).size !== lines.length) {
      throw new CustomException("A material can appear once per delivery.", badRequest);
    }
    const invoiceRef = nullableText(body.invoiceRef, "invoiceRef", 100) ?? null;
    const note = nullableText(body.note, "note", 500) ?? null;
    const actor = actorOf(user);
    await requireOrder(id, scope);

    await OpsPurchaseOrderQuery.inTransaction(async (tx) => {
      // The lock and the status check are one statement; from here the order is ours.
      if (!(await OpsPurchaseOrderQuery.lockInStatus(id, scope, OUTSTANDING_STATUSES, tx))) {
        if (!(await OpsPurchaseOrderQuery.findById(id, scope, tx))) throw notFoundError(NOT_FOUND);
        throw new CustomException("Only a sent purchase order can receive goods.", conflict);
      }
      const order = await OpsPurchaseOrderQuery.findById(id, scope, tx);
      if (!order) throw notFoundError(NOT_FOUND);
      const byMaterial = new Map(order.items.map((item) => [item.materialId, item]));
      const received = new Map<string, number>();
      let valueDelta = 0;
      for (const line of lines) {
        const item = byMaterial.get(line.materialId);
        if (!item) throw new CustomException("A received material is not on this purchase order.", badRequest);
        const total = item.receivedMilli + line.quantityMilli;
        if (total > item.quantityMilli) {
          throw new CustomException(`More ${item.materialName} received than is still outstanding.`, conflict);
        }
        received.set(item.id, total);
        valueDelta += lineValue(item.unitPricePaise, total) - lineValue(item.unitPricePaise, item.receivedMilli);
      }
      const complete = order.items.every((item) => (received.get(item.id) ?? item.receivedMilli) === item.quantityMilli);
      const status: PurchaseOrderStatus = complete ? "received" : "partially_received";
      const now = new Date();
      const applied = await OpsPurchaseOrderQuery.applyReceipt(
        id,
        {
          items: [...received].map(([itemId, receivedMilli]) => ({ itemId, receivedMilli })),
          receivedValueDeltaPaise: valueDelta,
          status,
          from: order.status,
          receivedAt: complete ? now : null,
          deliveredOnTime: complete ? (order.expectedOn ? istDateOf(now) <= order.expectedOn : null) : null,
          receipt: { invoiceRef, note, lines, byUserId: actor.id, byName: actor.name },
          event: {
            fromStatus: order.status,
            toStatus: status,
            note: [invoiceRef ? `Invoice ${invoiceRef}` : null, note].filter(Boolean).join(". ") || null,
            byUserId: actor.id,
            byName: actor.name,
          },
        },
        tx
      );
      if (!applied) throw staleOrder();
      for (const line of lines) await OpsMaterialQuery.addStock(line.materialId, order.storeId, line.quantityMilli, tx);
    });
    return toPurchaseOrderView(await requireOrder(id, scope));
  } catch (error) {
    throw toCustomException(error);
  }
};

// What is running low per store, net of what is already on its way, and how much to order.
const requirements = async (scope: StoreScope, query: Record<string, unknown>) => {
  try {
    const page = parsePage(query);
    const asked = listStore(scope, query);
    if (asked.empty) return toPage([], 0, page);
    let storeIds: string[];
    if (asked.storeId) {
      if (!(await StoreQuery.findById(asked.storeId, null))) throw notFoundError("Store");
      storeIds = [asked.storeId];
    } else {
      storeIds = (await StoreQuery.list(null, "live")).slice(0, MAX_REPORT_STORES).map((s) => s.id);
    }
    const materials = await OpsMaterialQuery.listWithReorderLevel(MAX_REPORT_MATERIALS);
    if (materials.length === 0 || storeIds.length === 0) return toPage([], 0, page);
    const ids = materials.map((m) => m.id);
    const [stock, onOrder] = await Promise.all([
      OpsMaterialQuery.stockFor(ids, storeIds),
      OpsPurchaseOrderQuery.onOrder(ids, storeIds),
    ]);
    const key = (materialId: string, storeId: string) => `${materialId}:${storeId}`;
    const held = new Map(stock.map((s) => [key(s.materialId, s.storeId), s.quantityMilli]));
    const coming = new Map(onOrder.map((o) => [key(o.materialId, o.storeId), o.quantityMilli]));

    const rows = [];
    for (const material of materials) {
      for (const storeId of storeIds) {
        const current = held.get(key(material.id, storeId)) ?? 0;
        if (current > material.reorderLevelMilli) continue;
        const incoming = coming.get(key(material.id, storeId)) ?? 0;
        const suggested = Math.max(0, TARGET_LEVEL_FACTOR * material.reorderLevelMilli - current - incoming);
        if (suggested === 0) continue;
        rows.push({
          materialId: material.id,
          name: material.name,
          unit: material.unit,
          storeId,
          currentQty: milliToQuantity(current),
          reorderLevel: milliToQuantity(material.reorderLevelMilli),
          onOrderQty: milliToQuantity(incoming),
          suggestedQty: milliToQuantity(suggested),
          preferredVendorId: material.preferredVendorId,
        });
      }
    }
    return toPage(rows.slice(page.offset, page.offset + page.limit), rows.length, page);
  } catch (error) {
    throw toCustomException(error);
  }
};

const spend = async (scope: StoreScope, query: Record<string, unknown>) => {
  try {
    const range = parseRange(query);
    const vendorId = optionalUuid(queryString(query.vendorId, "vendorId"), "vendorId");
    const rows = await OpsPurchaseOrderQuery.spendByVendor(scope, range, vendorId);
    const vendors = new Map((await OpsVendorQuery.findByIds(rows.map((r) => r.vendorId))).map((v) => [v.id, v.name]));
    return {
      total: toRupees(rows.reduce((sum, r) => sum + r.spendPaise, 0)),
      byVendor: rows.map((r) => ({ vendorId: r.vendorId, name: vendors.get(r.vendorId) ?? "", spend: toRupees(r.spendPaise) })),
    };
  } catch (error) {
    throw toCustomException(error);
  }
};

export const OpsPurchaseOrderService = { create, list, getById, updateDraft, send, cancel, receive, requirements, spend };
