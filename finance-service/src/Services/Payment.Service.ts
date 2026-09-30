import crypto from "crypto";
import { CustomException } from "../../commons/Exception/CustomException.js";
import { toCustomException } from "../../commons/Exception/ToCustomException.js";
import { requireFields } from "../../commons/Utils/Validation.js";
import { badRequest, conflict, notFound, serviceUnavailable } from "../../commons/Utils/StatusCode.js";
import { PaymentClient } from "../Clients/Payment.Client.js";
import { Db, PaymentQuery } from "../Queries/Payment.Query.js";
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

const toPublic = (payment: IPayment) => ({
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
  if (status === "captured" && !payment.capturedAt) data.capturedAt = new Date();
  return await PaymentQuery.update(payment.id, data, db);
};

const createCheckout = async (input: { orderRef?: unknown; amount?: unknown }, userId: string | null) => {
  try {
    requireFields(input, ["orderRef", "amount"]);
    const orderRef = String(input.orderRef).trim();
    if (!orderRef || orderRef.length > 64) {
      throw new CustomException("orderRef must be 1 to 64 characters.", badRequest);
    }
    const amountPaise = toPaise(input.amount);

    if (await PaymentQuery.hasPaidForOrder(orderRef)) {
      throw new CustomException("This order is already paid.", conflict);
    }

    const order = await PaymentClient.createOrder({
      amountPaise,
      currency: CURRENCY,
      receipt: orderRef,
      notes: { orderRef },
    });
    const payment = await PaymentQuery.create({
      orderRef,
      razorpayOrderId: order.id,
      amountPaise,
      currency: CURRENCY,
      createdByUserId: userId,
    });
    return toCheckout(payment);
  } catch (error) {
    throw toCustomException(error);
  }
};

// Called by the app after Checkout returns. The signature proves the app was handed
// these ids by Razorpay; the status then comes from Razorpay itself, not the client.
const confirmCheckout = async (input: {
  razorpayOrderId?: string;
  razorpayPaymentId?: string;
  razorpaySignature?: string;
}) => {
  try {
    requireFields(input, ["razorpayOrderId", "razorpayPaymentId", "razorpaySignature"]);
    const { razorpayOrderId, razorpayPaymentId, razorpaySignature } = input as Record<string, string>;

    const payment = await PaymentQuery.findByRazorpayOrderId(razorpayOrderId);
    if (!payment) throw new CustomException("Payment not found.", notFound);

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
        const refunded = payment.refundedPaise + Number(body.payload?.refund?.entity?.amount ?? 0);
        await PaymentQuery.update(
          payment.id,
          {
            refundedPaise: refunded,
            status: refunded >= payment.amountPaise ? "refunded" : payment.status,
          },
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

export const PaymentService = { createCheckout, confirmCheckout, handleWebhook };
