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
  createdAt: Date;
  updatedAt: Date;
}

export interface IPaymentCreate {
  orderRef: string;
  razorpayOrderId: string;
  amountPaise: number;
  currency: string;
  createdByUserId: string | null;
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
