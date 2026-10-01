export type PaymentStatus = "created" | "authorized" | "captured" | "failed" | "refunded";

export interface IPayment {
  id: string;
  orderRef: string;
  razorpayOrderId: string;
  razorpayPaymentId: string | null;
  amountPaise: number;
  currency: string;
  status: PaymentStatus;
  method: string | null;
  failureReason: string | null;
  refundedPaise: number;
  capturedAt: Date | null;
  amountMismatch: boolean;
  gatewayAmountPaise: number | null;
  createdByUserId: string | null;
  storeId: string | null;
  customerUserId: string | null;
  idempotencyOwner: string | null;
  idempotencyKey: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface IPaymentCreate {
  orderRef: string;
  razorpayOrderId: string;
  amountPaise: number;
  currency: string;
  createdByUserId: string | null;
  storeId?: string | null;
  customerUserId?: string | null;
  idempotencyOwner?: string | null;
  idempotencyKey?: string | null;
}

export type IPaymentUpdate = Partial<
  Pick<
    IPayment,
    | "razorpayPaymentId"
    | "status"
    | "method"
    | "failureReason"
    | "refundedPaise"
    | "capturedAt"
    | "amountMismatch"
    | "gatewayAmountPaise"
  >
>;

/** The part of a Razorpay payment the service acts on, whichever path reported it. */
export interface IGatewayPayment {
  id: string;
  orderId: string;
  status: PaymentStatus;
  amount: number;
  method: string | null;
  errorDescription: string | null;
}

export interface IPaymentFilter {
  storeId?: string;
  status?: PaymentStatus;
  method?: string;
  from?: Date;
  to?: Date;
}

export type MismatchResolution = "matched" | "refunded" | "written_off" | "manual_adjust";

export interface IMismatchResolution {
  paymentId: string;
  resolution: MismatchResolution;
  note: string;
  resolvedByUserId: string;
  resolvedByName: string | null;
  createdAt: Date;
}

/** A mismatching payment with its decision, when one has been made. */
export interface IMismatch {
  payment: IPayment;
  resolution: IMismatchResolution | null;
}
