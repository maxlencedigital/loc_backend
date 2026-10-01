import { ServiceClient } from "../../commons/Http/ServiceClient.js";
import { isUuid } from "../Utils/Uuid.js";

// Everything the support, feedback and payment modules ask of other services, in one place.
// Shapes are the agreed internal contract (IMPLEMENTATION_GUIDE section 6).

export interface IGatewayUser {
  id: string;
  name: string;
  email?: string | null;
  phoneNumber?: string | null;
  role: string;
  storeId: string | null;
  isActive: boolean;
}

export interface IPaymentCheckout {
  paymentId: string;
  razorpayOrderId: string;
  amountPaise: number;
  currency: string;
  keyId: string;
}

export interface IPaymentVerification {
  paymentId: string;
  orderRef: string;
  status: string;
  amountPaise: number;
}

/** One user by id, or null when the gateway does not know it. */
const findUser = async (id: string): Promise<IGatewayUser | null> => {
  const answer = await ServiceClient.post<{ users?: IGatewayUser[] }>("gateway", "/internal/users/lookup", {
    body: { ids: [id] },
    idempotent: true,
  });
  return answer?.users?.find((user) => user.id === id) ?? null;
};

const RIDER_LOOKUP_TIMEOUT_MS = 1_500;

// Best effort: a rating must never fail because logistics is slow or down, so any problem is
// "rider unknown". The delivery job carries the rider; a pickup rider is not who delivered.
const findDeliveryRiderId = async (orderId: string): Promise<string | null> => {
  try {
    const answer = await ServiceClient.get<{ jobs?: Array<{ type?: string; riderId?: string | null }> }>(
      "logistics",
      "/internal/jobs",
      { query: { orderId }, timeoutMs: RIDER_LOOKUP_TIMEOUT_MS }
    );
    const job = answer?.jobs?.find((j) => j.type === "delivery" && isUuid(j.riderId));
    return job?.riderId ?? null;
  } catch (error) {
    console.error("[feedback] rider lookup failed:", (error as Error)?.message);
    return null;
  }
};

// The finance service answers a replayed idempotency key with the original checkout, so the
// call is safe to repeat and may be retried.
const createPaymentOrder = (body: {
  orderRef: string;
  amountPaise: number;
  customerUserId: string;
  idempotencyKey?: string;
}) => ServiceClient.post<IPaymentCheckout>("finance", "/internal/payments/orders", { body, idempotent: !!body.idempotencyKey });

const verifyPayment = (body: { razorpayOrderId: string; razorpayPaymentId: string; razorpaySignature: string }) =>
  ServiceClient.post<IPaymentVerification>("finance", "/internal/payments/verify", { body, idempotent: true });

export const SupportClient = { findUser, findDeliveryRiderId, createPaymentOrder, verifyPayment };
