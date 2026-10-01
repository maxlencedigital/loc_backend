import type { SpendMode } from "../Expense/Expense.Interface.js";

export interface IReceivable {
  id: string;
  invoiceId: string;
  customerId: string;
  storeId: string;
  orderRef: string | null;
  amountPaise: number;
  balancePaise: number;
  dueOn: string;
  lastRemindedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Contact details are read only to send a reminder; they are not part of IReceivable. */
export interface IReceivableContact {
  phone: string | null;
  email: string | null;
}

export interface IReceivableCreate {
  invoiceId: string;
  customerId: string;
  storeId: string;
  orderRef: string | null;
  amountPaise: number;
  dueOn: string;
  contactPhone: string | null;
  contactEmail: string | null;
}

export type ReceivableStatus = "open" | "overdue" | "paid";

export interface IReceivableFilter {
  customerId?: string;
  storeId?: string | null;
  status?: ReceivableStatus;
  /** Only balances due on or before this day (olderThanDays resolved against today). */
  dueOnOrBefore?: string;
  today: string;
}

export interface IReceivablePayment {
  id: string;
  receivableId: string;
  amountPaise: number;
  mode: SpendMode;
  reference: string | null;
  idempotencyKey: string | null;
  recordedByUserId: string;
  createdAt: Date;
}

export interface IAgingBucket {
  label: string;
  amountPaise: number;
  count: number;
}
