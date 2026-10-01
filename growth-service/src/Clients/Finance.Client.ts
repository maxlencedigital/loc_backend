import { ServiceClient } from "../../commons/Http/ServiceClient.js";
import { CustomException } from "../../commons/Exception/CustomException.js";
import { conflict, serviceUnavailable } from "../../commons/Utils/StatusCode.js";

// The checkout payload finance returns for an order it will collect money for.
export interface CheckoutPayload {
  paymentId: string;
  razorpayOrderId: string;
  amountPaise: number;
  currency: string;
  keyId: string;
}

/**
 * Creates (or, with the same idempotencyKey, returns) the Razorpay order. 409 passes through
 * (already paid); any other refusal or outage reaches the customer as a clean 503, because a
 * 404 or 400 from finance would be mistaken for a problem with the customer's own request.
 */
const createPaymentOrder = async (input: {
  orderRef: string;
  amountPaise: number;
  customerUserId: string;
  idempotencyKey: string;
}): Promise<CheckoutPayload> => {
  try {
    return await ServiceClient.post<CheckoutPayload>("finance", "/internal/payments/orders", { body: input, idempotent: true });
  } catch (error) {
    if (error instanceof CustomException && error.errorCode === conflict) throw error;
    console.error("[finance] payment order refused:", error instanceof Error ? error.message : error);
    throw new CustomException("Payments are unavailable right now. Please try again shortly.", serviceUnavailable);
  }
};

export const FinanceClient = { createPaymentOrder };
