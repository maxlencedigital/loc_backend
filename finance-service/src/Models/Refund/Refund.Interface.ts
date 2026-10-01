export type RefundStatus = "requested" | "approved" | "processed" | "failed";

export interface IRefund {
  id: string;
  paymentId: string;
  storeId: string | null;
  amountPaise: number;
  reason: string;
  status: RefundStatus;
  idempotencyKey: string | null;
  razorpayRefundId: string | null;
  failureReason: string | null;
  requestedByUserId: string;
  approvedByUserId: string | null;
  approvedAt: Date | null;
  processedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface IRefundCreate {
  paymentId: string;
  storeId: string | null;
  amountPaise: number;
  reason: string;
  idempotencyKey: string | null;
  requestedByUserId: string;
}

export interface IRefundFilter {
  status?: RefundStatus;
  from?: Date;
  to?: Date;
}
