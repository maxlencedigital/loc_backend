import crypto from "crypto";
import { CustomException } from "../../commons/Exception/CustomException.js";
import { toCustomException } from "../../commons/Exception/ToCustomException.js";
import { requireFields } from "../../commons/Utils/Validation.js";
import { badRequest, conflict, notFound, serviceUnavailable } from "../../commons/Utils/StatusCode.js";
import { PaymentClient } from "../Clients/Payment.Client.js";
import { isUniqueViolation } from "../Queries/DatabaseError.js";
import { Db, PaymentQuery } from "../Queries/Payment.Query.js";
import { isUuid } from "../Utils/Input.js";
import { LedgerService } from "./Ledger.Service.js";
import { RefundService } from "./Refund.Service.js";
import {
  IGatewayPayment,
  IPayment,
  IPaymentUpdate,
  PaymentStatus,
} from "../Models/Payment/Payment.Interface.js";

const CURRENCY = "INR";
const MIN_AMOUNT_PAISE = 100;
// The column is a 32-bit integer; this is also well past any laundry order.
const MAX_AMOUNT_PAISE = 2_000_000_000;

// A customer who fails and retries pays against the SAME Razorpay order, and events
// arrive out of order. So a row only ever moves up this ladder: a late "failed" can
// never undo a capture.
const STATUS_RANK: Record<PaymentStatus, number> = {
  created: 0,
  failed: 1,
  authorized: 2,
  captured: 3,
  refunded: 4,
};
export const mergeStatus = (current: PaymentStatus, incoming: PaymentStatus): PaymentStatus =>
  STATUS_RANK[incoming] > STATUS_RANK[current] ? incoming : current;

// What the app needs to open Checkout; the key id is public by design.
const toCheckout = (payment: IPayment) => ({
  paymentId: payment.id,
  razorpayOrderId: payment.razorpayOrderId,
  amountPaise: payment.amountPaise,
  currency: payment.currency,
  keyId: process.env.RAZORPAY_KEY_ID,
});

export const toPublic = (payment: IPayment) => ({
  paymentId: payment.id,
  orderRef: payment.orderRef,
  status: payment.status,
  amountPaise: payment.amountPaise,
  currency: payment.currency,
  method: payment.method,
  capturedAt: payment.capturedAt,
});

const toPaise = (amount: unknown): number => {
  const rupees = Number(amount);
  const paise = Math.round(rupees * 100);
  if (!Number.isFinite(rupees) || paise < MIN_AMOUNT_PAISE || paise > MAX_AMOUNT_PAISE) {
    throw new CustomException("amount must be a valid rupee amount of at least 1.00.", badRequest);
  }
  return paise;
};

// Folds what the gateway says about a payment into our row. Shared by the
// checkout confirmation and the webhook so both reach the same conclusion.
const applyGatewayPayment = async (payment: IPayment, gateway: IGatewayPayment, db: Db): Promise<IPayment> => {
  const status = mergeStatus(payment.status, gateway.status);
  const data: IPaymentUpdate = {
    razorpayPaymentId: gateway.id,
    status,
    method: gateway.method ?? payment.method,
    // The money moved even if the amount is wrong, so the row is updated and then
    // flagged for a person to look at, rather than dropped.
    amountMismatch: payment.amountMismatch || gateway.amount !== payment.amountPaise,
    gatewayAmountPaise: gateway.amount,
  };
  if (gateway.status === "failed" && status === "failed") data.failureReason = gateway.errorDescription;
  const firstCapture = status === "captured" && !payment.capturedAt;
  if (firstCapture) data.capturedAt = new Date();
  const updated = await PaymentQuery.update(payment.id, data, db);
  // The money received is what the gateway says moved, which can differ from what was asked.
  if (firstCapture) await LedgerService.postCapture(updated, gateway.amount, db);
  return updated;
};

interface CheckoutParams {
  orderRef: string;
  amountPaise: number;
  createdByUserId: string | null;
  customerUserId: string | null;
  storeId: string | null;
  idempotencyKey: string | null;
}

const validOrderRef = (value: unknown): string => {
  const orderRef = typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
  if (!orderRef || orderRef.length > 64) {
    throw new CustomException("orderRef must be 1 to 64 characters.", badRequest);
  }
  return orderRef;
};

const validKey = (value: unknown): string | null => {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !/^[\x21-\x7e]{1,128}$/.test(value)) {
    throw new CustomException("Idempotency-Key must be 1 to 128 printable characters without spaces.", badRequest);
  }
  return value;
};

// The one place a checkout is created, whoever asks (staff in the dashboard, or commerce for a
// customer): same amount limits, same already-paid refusal, same Idempotency-Key rule.
const createCheckoutFor = async (params: CheckoutParams) => {
  const owner = params.customerUserId ?? params.createdByUserId;
  const key = owner ? params.idempotencyKey : null;

  // A retry with the same key gets the original checkout back, never a second Razorpay order.
  const replay = (earlier: IPayment) => {
    if (earlier.orderRef !== params.orderRef || earlier.amountPaise !== params.amountPaise) {
      throw new CustomException("This Idempotency-Key was already used for a different payment.", conflict);
    }
    return toCheckout(earlier);
  };
  if (key && owner) {
    const earlier = await PaymentQuery.findByIdempotency(owner, key);
    if (earlier) return replay(earlier);
  }

  if (await PaymentQuery.hasPaidForOrder(params.orderRef)) {
    throw new CustomException("This order is already paid.", conflict);
  }

  const order = await PaymentClient.createOrder({
    amountPaise: params.amountPaise,
    currency: CURRENCY,
    receipt: params.orderRef,
    notes: { orderRef: params.orderRef },
  });
  try {
    const payment = await PaymentQuery.create({
      orderRef: params.orderRef,
      razorpayOrderId: order.id,
      amountPaise: params.amountPaise,
      currency: CURRENCY,
      createdByUserId: params.createdByUserId,
      customerUserId: params.customerUserId,
      storeId: params.storeId,
      idempotencyOwner: key ? owner : null,
      idempotencyKey: key,
    });
    return toCheckout(payment);
  } catch (error) {
    // Two requests with one key raced: the unique (owner, key) let one in. Answer with its result.
    if (key && owner && isUniqueViolation(error)) {
      const earlier = await PaymentQuery.findByIdempotency(owner, key);
      if (earlier) return replay(earlier);
    }
    throw error;
  }
};

const createCheckout = async (
  input: { orderRef?: unknown; amount?: unknown },
  userId: string | null,
  options: { storeId?: string | null; idempotencyKey?: string | null } = {}
) => {
  try {
    requireFields(input, ["orderRef", "amount"]);
    return await createCheckoutFor({
      orderRef: validOrderRef(input.orderRef),
      amountPaise: toPaise(input.amount),
      createdByUserId: userId,
      customerUserId: null,
      storeId: options.storeId ?? null,
      idempotencyKey: validKey(options.idempotencyKey),
    });
  } catch (error) {
    throw toCustomException(error);
  }
};

// Commerce calls this for a customer's order. There is no staff user, so no role applies; the
// customer id owns the idempotency key. The amount is whole paise already priced by commerce.
const createInternalCheckout = async (input: Record<string, unknown>, headerKey: string | undefined) => {
  try {
    requireFields(input, ["orderRef", "amountPaise", "customerUserId"]);
    const amountPaise = input.amountPaise;
    if (
      typeof amountPaise !== "number" ||
      !Number.isInteger(amountPaise) ||
      amountPaise < MIN_AMOUNT_PAISE ||
      amountPaise > MAX_AMOUNT_PAISE
    ) {
      throw new CustomException("amountPaise must be a whole number of paise of at least 100.", badRequest);
    }
    if (!isUuid(input.customerUserId)) throw new CustomException("customerUserId must be a valid id.", badRequest);
    if (input.storeId !== undefined && input.storeId !== null && !isUuid(input.storeId)) {
      throw new CustomException("storeId must be a valid id.", badRequest);
    }
    return await createCheckoutFor({
      orderRef: validOrderRef(input.orderRef),
      amountPaise,
      createdByUserId: null,
      customerUserId: input.customerUserId.toLowerCase(),
      storeId: typeof input.storeId === "string" ? input.storeId.toLowerCase() : null,
      idempotencyKey: validKey(headerKey || input.idempotencyKey),
    });
  } catch (error) {
    throw toCustomException(error);
  }
};

const listForOrder = async (orderRef: unknown) => {
  try {
    const payments = await PaymentQuery.listByOrderRef(validOrderRef(orderRef), 50);
    return { payments: payments.map((p) => ({ ...toPublic(p), refundedPaise: p.refundedPaise })) };
  } catch (error) {
    throw toCustomException(error);
  }
};

// Called by the app after Checkout returns. The signature proves the app was handed
// these ids by Razorpay; the status then comes from Razorpay itself, not the client.
const confirmCheckout = async (
  input: {
    razorpayOrderId?: string;
    razorpayPaymentId?: string;
    razorpaySignature?: string;
  },
  expectedCustomerUserId?: string
) => {
  try {
    requireFields(input, ["razorpayOrderId", "razorpayPaymentId", "razorpaySignature"]);
    const { razorpayOrderId, razorpayPaymentId, razorpaySignature } = input as Record<string, string>;

    const payment = await PaymentQuery.findByRazorpayOrderId(razorpayOrderId);
    if (!payment) throw new CustomException("Payment not found.", notFound);
    // When commerce names the customer, another customer's payment is simply not found.
    if (expectedCustomerUserId && payment.customerUserId && payment.customerUserId !== expectedCustomerUserId) {
      throw new CustomException("Payment not found.", notFound);
    }

    if (!PaymentClient.verifyCheckoutSignature(razorpayOrderId, razorpayPaymentId, razorpaySignature)) {
      throw new CustomException("Payment signature is invalid.", badRequest);
    }

    let gateway = await PaymentClient.fetchPayment(razorpayPaymentId);
    if (gateway.orderId !== payment.razorpayOrderId) {
      throw new CustomException("Payment does not belong to this order.", badRequest);
    }
    if (gateway.status === "authorized" && process.env.RAZORPAY_CAPTURE_MODE === "manual") {
      gateway = await PaymentClient.capturePayment(razorpayPaymentId, payment.amountPaise, payment.currency);
    }

    const updated = await PaymentQuery.inTransaction(async (tx) => {
      const locked = await PaymentQuery.lockByRazorpayOrderId(payment.razorpayOrderId, tx);
      return await applyGatewayPayment(locked as IPayment, gateway, tx);
    });
    return toPublic(updated);
  } catch (error) {
    throw toCustomException(error);
  }
};

interface RazorpayWebhookBody {
  event?: string;
  payload?: {
    payment?: { entity?: Record<string, any> };
    refund?: { entity?: Record<string, any> };
  };
}

// Handles one signed Razorpay event. Returns what happened so the controller can
// always answer 200 for a valid event: a non-2xx only makes Razorpay retry it.
const handleWebhook = async (
  rawBody: Buffer | undefined,
  signature: string | undefined,
  eventIdHeader: string | undefined
): Promise<{ outcome: "processed" | "duplicate" | "ignored" }> => {
  try {
    if (!PaymentClient.webhookConfigured()) {
      console.error("[payments] RAZORPAY_WEBHOOK_SECRET is not set; rejecting webhook.");
      throw new CustomException("Webhook verification is not configured.", serviceUnavailable);
    }
    if (!rawBody || !signature) {
      throw new CustomException("Missing webhook signature.", badRequest);
    }
    if (!PaymentClient.verifyWebhookSignature(rawBody, signature)) {
      throw new CustomException("Invalid webhook signature.", badRequest);
    }

    let body: RazorpayWebhookBody;
    try {
      body = JSON.parse(rawBody.toString("utf8"));
    } catch {
      throw new CustomException("Webhook body is not valid JSON.", badRequest);
    }
    const type = body.event ?? "";
    const paymentEntity = body.payload?.payment?.entity;
    // The provider's own event id when sent; else the body hash, identical on a replay.
    const eventId = eventIdHeader || crypto.createHash("sha256").update(rawBody).digest("hex");

    return await PaymentQuery.inTransaction(async (tx) => {
      const isNew = await PaymentQuery.recordWebhookEvent({ eventId, type, payload: body as object }, tx);
      if (!isNew) return { outcome: "duplicate" as const };

      if (!paymentEntity?.order_id) return { outcome: "ignored" as const };
      const payment = await PaymentQuery.lockByRazorpayOrderId(paymentEntity.order_id, tx);
      if (!payment) {
        // Not one of ours (another integration on the same Razorpay account).
        console.error(`[payments] webhook ${type} for unknown order ${paymentEntity.order_id}`);
        return { outcome: "ignored" as const };
      }

      if (type === "refund.processed") {
        const refundEntity = body.payload?.refund?.entity;
        const refundAmount = Number(refundEntity?.amount ?? 0);
        const refunded = payment.refundedPaise + refundAmount;
        const updated = await PaymentQuery.update(
          payment.id,
          {
            refundedPaise: refunded,
            status: refunded >= payment.amountPaise ? "refunded" : payment.status,
          },
          tx
        );
        await RefundService.confirmFromGateway(
          { gatewayRefundId: typeof refundEntity?.id === "string" ? refundEntity.id : null, amountPaise: refundAmount },
          updated,
          tx
        );
        return { outcome: "processed" as const };
      }

      if (type.startsWith("payment.")) {
        await applyGatewayPayment(payment, PaymentClient.toGatewayPayment(paymentEntity as any), tx);
        return { outcome: "processed" as const };
      }
      return { outcome: "ignored" as const };
    });
  } catch (error) {
    throw toCustomException(error);
  }
};

export const PaymentService = {
  createCheckout,
  createInternalCheckout,
  confirmCheckout,
  listForOrder,
  handleWebhook,
};
