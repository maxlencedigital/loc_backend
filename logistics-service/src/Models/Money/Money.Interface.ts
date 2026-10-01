export const PAYMENT_METHODS = ["cash", "upi", "card"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export type FieldPaymentStatus = "collected" | "settled";

export interface IFieldPayment {
  id: string;
  jobId: string;
  orderId: string;
  riderId: string;
  storeId: string;
  amountPaise: number;
  method: PaymentMethod;
  reference: string | null;
  status: FieldPaymentStatus;
  collectedAt: Date;
  settledAt: Date | null;
  settledAmountPaise: number | null;
  settledByUserId: string | null;
  settledStoreId: string | null;
  settleNote: string | null;
  idempotencyKey: string | null;
}

export type IFieldPaymentCreate = Pick<
  IFieldPayment,
  "jobId" | "orderId" | "riderId" | "storeId" | "amountPaise" | "method" | "reference" | "status" | "idempotencyKey"
> & { settledAt: Date | null; settledAmountPaise: number | null };

export interface IFieldPaymentFilter {
  storeId?: string | null;
  riderId?: string | null;
  status?: FieldPaymentStatus | null;
  from?: Date | null;
  to?: Date | null;
}

export type LedgerKind = "job_base" | "job_express" | "shift_bonus" | "bonus" | "penalty" | "payout";

export interface ILedgerEntryCreate {
  riderId: string;
  shiftId: string | null;
  jobId: string | null;
  kind: LedgerKind;
  amountPaise: number;
  reason: string | null;
  dedupeKey: string | null;
  createdByUserId: string | null;
}

/** Sum of the ledger by kind over a period. */
export type LedgerTotals = Partial<Record<LedgerKind, number>>;

export interface ICashTotals {
  collectedPaise: number;
  settledPaise: number;
}
