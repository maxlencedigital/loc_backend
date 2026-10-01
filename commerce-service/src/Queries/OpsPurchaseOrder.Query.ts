import type { Prisma } from "@prisma/client";
import { prisma } from "../DB/Prisma.Connection.Db.js";
import { IPage } from "../Models/OpsVendors/Vendor.Interface.js";
import {
  COMMITTED_STATUSES,
  IEventWrite,
  IItemWrite,
  IOnOrderRow,
  IPurchaseOrder,
  IPurchaseOrderCreate,
  IPurchaseOrderFilter,
  IPurchaseOrderSummary,
  IReceiptLine,
  ISpendRow,
  IVendorHistory,
  OUTSTANDING_STATUSES,
  PurchaseOrderStatus,
} from "../Models/OpsVendors/PurchaseOrder.Interface.js";
import { fromDbDate, toDbDate } from "../Utils/OpsDates.js";

export type Db = Prisma.TransactionClient;

const PO_COUNTER = "purchase_order_ref";
const MAX_SPEND_ROWS = 200;

const detailInclude = {
  vendor: { select: { name: true } },
  items: { orderBy: { position: "asc" } },
  events: { orderBy: [{ at: "asc" }, { id: "asc" }] },
  receipts: { orderBy: [{ receivedAt: "asc" }, { id: "asc" }] },
} satisfies Prisma.OpsPurchaseOrderInclude;

type DetailRow = Prisma.OpsPurchaseOrderGetPayload<{ include: typeof detailInclude }>;

const toSummary = (row: Prisma.OpsPurchaseOrderGetPayload<object>): IPurchaseOrderSummary => ({
  id: row.id,
  number: row.number,
  vendorId: row.vendorId,
  storeId: row.storeId,
  status: row.status,
  totalPaise: row.totalPaise,
  receivedValuePaise: row.receivedValuePaise,
  expectedOn: row.expectedOn ? fromDbDate(row.expectedOn) : null,
  sentAt: row.sentAt,
  createdAt: row.createdAt,
});

const toOrder = (row: DetailRow): IPurchaseOrder => ({
  ...toSummary(row),
  vendorName: row.vendor.name,
  notes: row.notes,
  receivedAt: row.receivedAt,
  deliveredOnTime: row.deliveredOnTime,
  cancelledAt: row.cancelledAt,
  cancelReason: row.cancelReason,
  createdBy: row.createdBy,
  updatedAt: row.updatedAt,
  items: row.items.map(({ purchaseOrderId: _p, storeId: _s, position: _pos, ...item }) => item),
  events: row.events.map(({ id: _id, purchaseOrderId: _p, ...event }) => event),
  receipts: row.receipts.map((receipt) => ({
    id: receipt.id,
    invoiceRef: receipt.invoiceRef,
    note: receipt.note,
    lines: receipt.lines as unknown as IReceiptLine[],
    byName: receipt.byName,
    receivedAt: receipt.receivedAt,
  })),
});

const inTransaction = async <T>(work: (tx: Db) => Promise<T>): Promise<T> => {
  try {
    return await prisma.$transaction(work);
  } catch (error) {
    throw error;
  }
};

// One atomic UPDATE .. RETURNING; its row lock lasts until the order is committed, so two
// simultaneous orders queue for a number instead of racing for the same one.
const nextNumber = async (db: Db): Promise<string> => {
  try {
    const counter = await db.sequenceCounter.update({
      where: { name: PO_COUNTER },
      data: { value: { increment: 1 } },
    });
    return `PO-${counter.value}`;
  } catch (error) {
    throw error;
  }
};

const itemRows = (storeId: string, items: IItemWrite[]) =>
  items.map((item, position) => ({ ...item, storeId, position }));

const create = async (number: string, data: IPurchaseOrderCreate, db: Db): Promise<IPurchaseOrder> => {
  try {
    const { items, firstEvent, expectedOn, ...order } = data;
    const row = await db.opsPurchaseOrder.create({
      data: {
        ...order,
        number,
        expectedOn: expectedOn ? toDbDate(expectedOn) : null,
        items: { create: itemRows(data.storeId, items) },
        events: { create: [{ fromStatus: null, toStatus: "draft", ...firstEvent }] },
      },
      include: detailInclude,
    });
    return toOrder(row);
  } catch (error) {
    throw error;
  }
};

const scopeWhere = (scope: string | null) => (scope ? { storeId: scope } : {});

const findById = async (id: string, scope: string | null, db: Db = prisma): Promise<IPurchaseOrder | null> => {
  try {
    const row = await db.opsPurchaseOrder.findFirst({ where: { id, ...scopeWhere(scope) }, include: detailInclude });
    return row ? toOrder(row) : null;
  } catch (error) {
    throw error;
  }
};

const findByIdempotencyKey = async (createdBy: string, key: string, db: Db = prisma): Promise<IPurchaseOrder | null> => {
  try {
    const row = await db.opsPurchaseOrder.findFirst({
      where: { createdBy, idempotencyKey: key },
      include: detailInclude,
    });
    return row ? toOrder(row) : null;
  } catch (error) {
    throw error;
  }
};

const list = async (filter: IPurchaseOrderFilter, db: Db = prisma): Promise<IPage<IPurchaseOrderSummary>> => {
  try {
    const where: Prisma.OpsPurchaseOrderWhereInput = {
      ...scopeWhere(filter.storeId),
      ...(filter.vendorId ? { vendorId: filter.vendorId } : {}),
      ...(filter.statuses ? { status: { in: filter.statuses } } : {}),
    };
    const [rows, total] = await Promise.all([
      db.opsPurchaseOrder.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        skip: filter.offset,
        take: filter.limit,
      }),
      db.opsPurchaseOrder.count({ where }),
    ]);
    return { items: rows.map(toSummary), total };
  } catch (error) {
    throw error;
  }
};

// The no-op UPDATE is the row lock, and the status condition is the guard in the same
// statement: false means the order is missing, out of scope, or no longer in a status that
// allows the action. The caller works on the order only while holding this lock.
const lockInStatus = async (
  id: string,
  scope: string | null,
  statuses: readonly PurchaseOrderStatus[],
  db: Db
): Promise<boolean> => {
  try {
    const { count } = await db.opsPurchaseOrder.updateMany({
      where: { id, ...scopeWhere(scope), status: { in: [...statuses] } },
      data: { updatedAt: new Date() },
    });
    return count > 0;
  } catch (error) {
    throw error;
  }
};

// Edits a draft the caller has locked. Items, when given, replace the whole list.
const updateDraft = async (
  id: string,
  storeId: string,
  data: { expectedOn?: string | null; notes?: string | null; items?: IItemWrite[]; totalPaise?: number },
  db: Db
): Promise<void> => {
  try {
    const { items, expectedOn, ...fields } = data;
    if (items) {
      await db.opsPurchaseOrderItem.deleteMany({ where: { purchaseOrderId: id } });
      await db.opsPurchaseOrderItem.createMany({
        data: itemRows(storeId, items).map((item) => ({ ...item, purchaseOrderId: id })),
      });
    }
    await db.opsPurchaseOrder.update({
      where: { id },
      data: {
        ...fields,
        ...(expectedOn !== undefined ? { expectedOn: expectedOn ? toDbDate(expectedOn) : null } : {}),
      },
    });
  } catch (error) {
    throw error;
  }
};

const appendEvent = async (id: string, event: IEventWrite, db: Db): Promise<void> => {
  try {
    await db.opsPurchaseOrderEvent.create({ data: { purchaseOrderId: id, ...event } });
  } catch (error) {
    throw error;
  }
};

// Conditional status change: UPDATE .. WHERE status = expected, and the history row only if
// it matched. False means someone else moved the order first.
const transition = async (
  id: string,
  from: PurchaseOrderStatus,
  data: { status: PurchaseOrderStatus; sentAt?: Date; cancelledAt?: Date; cancelReason?: string | null },
  event: IEventWrite,
  db: Db
): Promise<boolean> => {
  try {
    const { count } = await db.opsPurchaseOrder.updateMany({ where: { id, status: from }, data });
    if (count === 0) return false;
    await appendEvent(id, event, db);
    return true;
  } catch (error) {
    throw error;
  }
};

export interface IReceiptApply {
  items: { itemId: string; receivedMilli: number }[];
  receivedValueDeltaPaise: number;
  status: PurchaseOrderStatus;
  from: PurchaseOrderStatus;
  receivedAt: Date | null;
  deliveredOnTime: boolean | null;
  receipt: { invoiceRef: string | null; note: string | null; lines: IReceiptLine[]; byUserId: string; byName: string };
  event: IEventWrite;
}

// Writes one delivery against an order the caller has locked and re-read.
const applyReceipt = async (id: string, applied: IReceiptApply, db: Db): Promise<boolean> => {
  try {
    const { count } = await db.opsPurchaseOrder.updateMany({
      where: { id, status: applied.from },
      data: {
        status: applied.status,
        receivedValuePaise: { increment: applied.receivedValueDeltaPaise },
        ...(applied.receivedAt ? { receivedAt: applied.receivedAt, deliveredOnTime: applied.deliveredOnTime } : {}),
      },
    });
    if (count === 0) return false;
    for (const item of applied.items) {
      await db.opsPurchaseOrderItem.update({ where: { id: item.itemId }, data: { receivedMilli: item.receivedMilli } });
    }
    await db.opsPurchaseOrderReceipt.create({
      data: { purchaseOrderId: id, ...applied.receipt, lines: applied.receipt.lines as unknown as Prisma.InputJsonValue },
    });
    await appendEvent(id, applied.event, db);
    return true;
  } catch (error) {
    throw error;
  }
};

const sentWindow = (from?: Date, to?: Date): Prisma.OpsPurchaseOrderWhereInput =>
  from || to ? { sentAt: { ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) } } : {};

const spendByVendor = async (
  scope: string | null,
  range: { from?: Date; to?: Date },
  vendorId: string | undefined,
  db: Db = prisma
): Promise<ISpendRow[]> => {
  try {
    const groups = await db.opsPurchaseOrder.groupBy({
      by: ["vendorId"],
      where: {
        status: { in: [...COMMITTED_STATUSES] },
        ...scopeWhere(scope),
        ...sentWindow(range.from, range.to),
        ...(vendorId ? { vendorId } : {}),
      },
      _sum: { totalPaise: true },
      orderBy: { _sum: { totalPaise: "desc" } },
      take: MAX_SPEND_ROWS,
    });
    return groups.map((g) => ({ vendorId: g.vendorId, spendPaise: g._sum.totalPaise ?? 0 }));
  } catch (error) {
    throw error;
  }
};

const vendorHistory = async (
  vendorId: string,
  scope: string | null,
  range: { from?: Date; to?: Date },
  db: Db = prisma
): Promise<IVendorHistory> => {
  try {
    const cohort: Prisma.OpsPurchaseOrderWhereInput = {
      vendorId,
      status: { in: [...COMMITTED_STATUSES] },
      ...scopeWhere(scope),
      ...sentWindow(range.from, range.to),
    };
    const [totals, onTime, late, open] = await Promise.all([
      db.opsPurchaseOrder.aggregate({ where: cohort, _count: { _all: true }, _sum: { totalPaise: true } }),
      db.opsPurchaseOrder.count({ where: { ...cohort, deliveredOnTime: true } }),
      db.opsPurchaseOrder.count({ where: { ...cohort, deliveredOnTime: false } }),
      db.opsPurchaseOrder.aggregate({
        where: { vendorId, status: { in: [...OUTSTANDING_STATUSES] }, ...scopeWhere(scope) },
        _sum: { totalPaise: true, receivedValuePaise: true },
      }),
    ]);
    return {
      orders: totals._count._all,
      deliveredOnTime: onTime,
      deliveredLate: late,
      totalSpendPaise: totals._sum.totalPaise ?? 0,
      outstandingPaise: (open._sum.totalPaise ?? 0) - (open._sum.receivedValuePaise ?? 0),
    };
  } catch (error) {
    throw error;
  }
};

// Still-to-arrive quantity per material and store, over sent and part-delivered orders.
const onOrder = async (materialIds: string[], storeIds: string[], db: Db = prisma): Promise<IOnOrderRow[]> => {
  try {
    const groups = await db.opsPurchaseOrderItem.groupBy({
      by: ["materialId", "storeId"],
      where: {
        materialId: { in: materialIds },
        storeId: { in: storeIds },
        purchaseOrder: { status: { in: [...OUTSTANDING_STATUSES] } },
      },
      _sum: { quantityMilli: true, receivedMilli: true },
    });
    return groups.map((g) => ({
      materialId: g.materialId,
      storeId: g.storeId,
      quantityMilli: (g._sum.quantityMilli ?? 0) - (g._sum.receivedMilli ?? 0),
    }));
  } catch (error) {
    throw error;
  }
};

export const OpsPurchaseOrderQuery = {
  inTransaction,
  nextNumber,
  create,
  findById,
  findByIdempotencyKey,
  list,
  lockInStatus,
  updateDraft,
  transition,
  applyReceipt,
  spendByVendor,
  vendorHistory,
  onOrder,
};
