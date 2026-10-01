export type ReconciliationSource = "bank" | "razorpay";

export interface IReconciliationRun {
  id: string;
  source: ReconciliationSource;
  from: string;
  to: string;
  matched: number;
  exceptions: number;
  truncated: boolean;
  ranByUserId: string;
  ranAt: Date;
}

export interface IReconciliationException {
  id: string;
  reference: string;
  expectedPaise: number | null;
  actualPaise: number | null;
  reason: string;
}

export interface IReconciliationRunCreate {
  source: ReconciliationSource;
  from: string;
  to: string;
  matched: number;
  exceptionCount: number;
  truncated: boolean;
  ranByUserId: string;
  exceptions: Array<Omit<IReconciliationException, "id">>;
}

export interface IBankLineInput {
  date: string;
  description: string;
  reference: string | null;
  /** Credits positive, debits negative. */
  amountPaise: number;
  lineHash: string;
}

export interface IBankLine {
  id: string;
  date: string;
  description: string;
  reference: string | null;
  amountPaise: number;
}

export interface IBankStatement {
  id: string;
  bank: string | null;
  fileName: string;
  lineCount: number;
  skippedCount: number;
  createdAt: Date;
}

/** The slice of a payment that reconciliation compares against the provider or the bank. */
export interface IReconcilablePayment {
  id: string;
  orderRef: string;
  razorpayPaymentId: string | null;
  amountPaise: number;
  gatewayAmountPaise: number | null;
  status: string;
}
