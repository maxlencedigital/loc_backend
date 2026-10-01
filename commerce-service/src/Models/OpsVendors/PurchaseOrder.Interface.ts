import type { DateString } from "../../Utils/OpsDates.js";

export const PURCHASE_ORDER_STATUSES = ["draft", "sent", "partially_received", "received", "cancelled"] as const;
export type PurchaseOrderStatus = (typeof PURCHASE_ORDER_STATUSES)[number];

// What each status may become. Receiving can repeat while some quantity is still due.
// received and cancelled are final.
export const PURCHASE_ORDER_TRANSITIONS: Record<PurchaseOrderStatus, readonly PurchaseOrderStatus[]> = {
  draft: ["sent", "cancelled"],
  sent: ["partially_received", "received", "cancelled"],
  partially_received: ["partially_received", "received"],
  received: [],
  cancelled: [],
};

export const OUTSTANDING_STATUSES: readonly PurchaseOrderStatus[] = ["sent", "partially_received"];
// Orders that count as money committed to a vendor.
export const COMMITTED_STATUSES: readonly PurchaseOrderStatus[] = ["sent", "partially_received", "received"];

export interface IPurchaseOrderItem {
  id: string;
  materialId: string;
  materialName: string;
  unit: string;
  quantityMilli: number;
  receivedMilli: number;
  unitPricePaise: number | null;
  amountPaise: number;
}

export interface IPurchaseOrderEvent {
  fromStatus: PurchaseOrderStatus | null;
  toStatus: PurchaseOrderStatus;
  note: string | null;
  byUserId: string;
  byName: string;
  at: Date;
}

export interface IReceiptLine {
  materialId: string;
  quantityMilli: number;
}

export interface IPurchaseOrderReceipt {
  id: string;
  invoiceRef: string | null;
  note: string | null;
  lines: IReceiptLine[];
  byName: string;
  receivedAt: Date;
}

export interface IPurchaseOrderSummary {
  id: string;
  number: string;
  vendorId: string;
  storeId: string;
  status: PurchaseOrderStatus;
  totalPaise: number;
  receivedValuePaise: number;
  expectedOn: DateString | null;
  sentAt: Date | null;
  createdAt: Date;
}

export interface IPurchaseOrder extends IPurchaseOrderSummary {
  vendorName: string;
  notes: string | null;
  receivedAt: Date | null;
  deliveredOnTime: boolean | null;
  cancelledAt: Date | null;
  cancelReason: string | null;
  createdBy: string;
  updatedAt: Date;
  items: IPurchaseOrderItem[];
  events: IPurchaseOrderEvent[];
  receipts: IPurchaseOrderReceipt[];
}

export interface IItemWrite {
  materialId: string;
  materialName: string;
  unit: string;
  quantityMilli: number;
  unitPricePaise: number | null;
  amountPaise: number;
}

export interface IPurchaseOrderCreate {
  vendorId: string;
  storeId: string;
  expectedOn: DateString | null;
  notes: string | null;
  totalPaise: number;
  items: IItemWrite[];
  createdBy: string;
  idempotencyKey: string | null;
  firstEvent: { byUserId: string; byName: string };
}

export interface IPurchaseOrderFilter {
  storeId: string | null;
  vendorId?: string;
  statuses?: PurchaseOrderStatus[];
  offset: number;
  limit: number;
}

export interface IEventWrite {
  fromStatus: PurchaseOrderStatus;
  toStatus: PurchaseOrderStatus;
  note: string | null;
  byUserId: string;
  byName: string;
}

export interface ISpendRow {
  vendorId: string;
  spendPaise: number;
}

export interface IVendorHistory {
  orders: number;
  deliveredOnTime: number;
  deliveredLate: number;
  totalSpendPaise: number;
  outstandingPaise: number;
}

export interface IOnOrderRow {
  materialId: string;
  storeId: string;
  quantityMilli: number;
}

export interface IStockRow {
  materialId: string;
  storeId: string;
  quantityMilli: number;
}
