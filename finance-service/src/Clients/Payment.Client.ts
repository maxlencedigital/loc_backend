import crypto from "crypto";
import { CustomException } from "../../commons/Exception/CustomException.js";
import { serviceUnavailable } from "../../commons/Utils/StatusCode.js";
import { toCustomException } from "../../commons/Exception/ToCustomException.js";
import { IGatewayPayment, PaymentStatus } from "../Models/Payment/Payment.Interface.js";

// The only file that talks to Razorpay. Plain HTTPS rather than the SDK: four
// calls and two HMACs, with no dependency to audit and every request visible here.

const API_TIMEOUT_MS = 10_000;
const apiBase = () => process.env.RAZORPAY_API_BASE || "https://api.razorpay.com/v1";

const isConfigured = () => Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);
const webhookConfigured = () => Boolean(process.env.RAZORPAY_WEBHOOK_SECRET);

const hmacHex = (secret: string, data: string | Buffer) =>
  crypto.createHmac("sha256", secret).update(data).digest("hex");

// Constant-time, so response timing cannot be used to guess a signature byte by byte.
const safeEqualHex = (expected: string, given: string): boolean => {
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(given, "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

const unavailable = () =>
  new CustomException("Payments are unavailable right now. Please try again.", serviceUnavailable);

// Errors for a request Razorpay answered with a 4xx: the call was understood and refused, so (unlike
// a timeout) it is known not to have happened.
const rejections = new WeakSet<object>();
const rejected = () => {
  const error = unavailable();
  rejections.add(error);
  return error;
};
const isProviderRejection = (error: unknown): boolean => typeof error === "object" && error !== null && rejections.has(error);

const call = async <T>(
  method: "GET" | "POST",
  path: string,
  body?: unknown,
  extraHeaders: Record<string, string> = {}
): Promise<T> => {
  if (!isConfigured()) {
    console.error("[payments] RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET are not set.");
    throw unavailable();
  }
  const auth = Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString("base64");

  let response: Response;
  try {
    response = await fetch(`${apiBase()}${path}`, {
      method,
      headers: { Authorization: `Basic ${auth}`, "content-type": "application/json", ...extraHeaders },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });
  } catch (error) {
    console.error(`[payments] Razorpay ${method} ${path} unreachable:`, (error as Error).message);
    throw unavailable();
  }

  const raw = await response.text();
  if (!response.ok) {
    // Razorpay explains a rejection in error.description; users never see it.
    console.error(`[payments] Razorpay ${method} ${path} -> HTTP ${response.status}: ${raw.slice(0, 300)}`);
    throw response.status >= 400 && response.status < 500 ? rejected() : unavailable();
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    console.error(`[payments] Razorpay ${method} ${path} returned non-JSON: ${raw.slice(0, 200)}`);
    throw unavailable();
  }
};

interface RazorpayOrder {
  id: string;
  amount: number;
  currency: string;
  status: string;
}

interface RazorpayPaymentEntity {
  id: string;
  order_id: string;
  status: string;
  amount: number;
  method?: string;
  error_description?: string | null;
}

const KNOWN_STATUSES: PaymentStatus[] = ["created", "authorized", "captured", "failed", "refunded"];

/** Maps Razorpay's payment entity (API response or webhook payload) to ours. */
const toGatewayPayment = (entity: RazorpayPaymentEntity): IGatewayPayment => {
  if (!entity?.id || !entity.order_id || !KNOWN_STATUSES.includes(entity.status as PaymentStatus)) {
    throw new CustomException("Unrecognised payment data from the provider.", serviceUnavailable);
  }
  return {
    id: entity.id,
    orderId: entity.order_id,
    status: entity.status as PaymentStatus,
    amount: entity.amount,
    method: entity.method ?? null,
    errorDescription: entity.error_description ?? null,
  };
};

const createOrder = async (params: {
  amountPaise: number;
  currency: string;
  receipt: string;
  notes?: Record<string, string>;
}): Promise<RazorpayOrder> => {
  try {
    return await call<RazorpayOrder>("POST", "/orders", {
      amount: params.amountPaise,
      currency: params.currency,
      // Razorpay caps the receipt at 40 characters.
      receipt: params.receipt.slice(0, 40),
      notes: params.notes,
    });
  } catch (error) {
    throw toCustomException(error);
  }
};

const fetchPayment = async (razorpayPaymentId: string): Promise<IGatewayPayment> => {
  try {
    return toGatewayPayment(
      await call<RazorpayPaymentEntity>("GET", `/payments/${encodeURIComponent(razorpayPaymentId)}`)
    );
  } catch (error) {
    throw toCustomException(error);
  }
};

// Only needed when the Razorpay account is set to manual capture; with automatic
// capture Razorpay does this itself and the call would be rejected.
const capturePayment = async (
  razorpayPaymentId: string,
  amountPaise: number,
  currency: string
): Promise<IGatewayPayment> => {
  try {
    return toGatewayPayment(
      await call<RazorpayPaymentEntity>("POST", `/payments/${encodeURIComponent(razorpayPaymentId)}/capture`, {
        amount: amountPaise,
        currency,
      })
    );
  } catch (error) {
    throw toCustomException(error);
  }
};

interface RazorpayRefundEntity {
  id: string;
  payment_id: string;
  amount: number;
  status: string;
}

export interface IGatewayRefund {
  id: string;
  paymentId: string;
  amountPaise: number;
  status: string;
}

// The refund id is sent as Razorpay's refund idempotency header, so a retry after a timeout
// returns the refund already created instead of making a second one.
const refundPayment = async (
  razorpayPaymentId: string,
  amountPaise: number,
  notes: Record<string, string>,
  idempotencyKey?: string
): Promise<IGatewayRefund> => {
  try {
    const entity = await call<RazorpayRefundEntity>(
      "POST",
      `/payments/${encodeURIComponent(razorpayPaymentId)}/refund`,
      { amount: amountPaise, notes },
      idempotencyKey ? { "X-Refund-Idempotency": idempotencyKey } : {}
    );
    if (!entity?.id) throw new CustomException("Unrecognised refund data from the provider.", serviceUnavailable);
    return { id: entity.id, paymentId: entity.payment_id, amountPaise: entity.amount, status: entity.status };
  } catch (error) {
    throw toCustomException(error);
  }
};

interface PaymentListPage {
  items: IGatewayPayment[];
  // Rows Razorpay returned that are not payments for one of our orders.
  ignored: number;
  fetched: number;
}

// One page of Razorpay payments created in [fromUnix, toUnix], for reconciliation.
const listPayments = async (params: {
  fromUnix: number;
  toUnix: number;
  count: number;
  skip: number;
}): Promise<PaymentListPage> => {
  try {
    const query = `from=${params.fromUnix}&to=${params.toUnix}&count=${params.count}&skip=${params.skip}`;
    const page = await call<{ items?: RazorpayPaymentEntity[] }>("GET", `/payments?${query}`);
    const entities = Array.isArray(page?.items) ? page.items : [];
    const items: IGatewayPayment[] = [];
    for (const entity of entities) {
      if (entity?.id && entity.order_id && KNOWN_STATUSES.includes(entity.status as PaymentStatus)) {
        items.push(toGatewayPayment(entity));
      }
    }
    return { items, ignored: entities.length - items.length, fetched: entities.length };
  } catch (error) {
    throw toCustomException(error);
  }
};

/** Checks the signature Razorpay Checkout returns to the app: HMAC(order_id|payment_id). */
const verifyCheckoutSignature = (orderId: string, paymentId: string, signature: string): boolean => {
  if (!isConfigured() || !signature) return false;
  return safeEqualHex(hmacHex(process.env.RAZORPAY_KEY_SECRET as string, `${orderId}|${paymentId}`), signature);
};

/** Checks X-Razorpay-Signature: HMAC of the RAW body, so it must not be re-serialised first. */
const verifyWebhookSignature = (rawBody: string | Buffer, signature: string): boolean => {
  if (!webhookConfigured() || !signature) return false;
  return safeEqualHex(hmacHex(process.env.RAZORPAY_WEBHOOK_SECRET as string, rawBody), signature);
};

export const PaymentClient = {
  isConfigured,
  webhookConfigured,
  createOrder,
  fetchPayment,
  capturePayment,
  refundPayment,
  listPayments,
  isProviderRejection,
  verifyCheckoutSignature,
  verifyWebhookSignature,
  toGatewayPayment,
};
