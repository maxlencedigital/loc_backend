import { CustomException } from "../../commons/Exception/CustomException.js";
import { toCustomException } from "../../commons/Exception/ToCustomException.js";
import { Page, PageRequest, toPage } from "../../commons/Utils/Pagination.js";
import { requireFields } from "../../commons/Utils/Validation.js";
import { conflict, forbidden, notFound } from "../../commons/Utils/StatusCode.js";
import { PaymentClient } from "../Clients/Payment.Client.js";
import { Actor } from "../Middleware/StoreScope.js";
import { IPayment } from "../Models/Payment/Payment.Interface.js";
import { IRefund, RefundStatus } from "../Models/Refund/Refund.Interface.js";
import type { Db } from "../Queries/Db.js";
import { PaymentQuery } from "../Queries/Payment.Query.js";
import { RefundQuery } from "../Queries/Refund.Query.js";
import { istDayEnd, istDayStart, optionalDayBounds } from "../Utils/Dates.js";
import { idempotencyKeyOf, isUuid, parseBody, pathId, queryEnum, text } from "../Utils/Input.js";
import { rupeesToPaise, toRupees } from "../Utils/Money.js";
import { LedgerService } from "./Ledger.Service.js";

const REFUND_STATUSES = ["requested", "approved", "processed", "failed"] as const;

const toPublic = (refund: IRefund) => ({
  id: refund.id,
  paymentId: refund.paymentId,
  amount: toRupees(refund.amountPaise),
  amountPaise: refund.amountPaise,
  status: refund.status,
  reason: refund.reason,
  requestedAt: refund.createdAt,
  approvedAt: refund.approvedAt,
  processedAt: refund.processedAt,
});

// What the customer actually paid: the gateway's figure wins over the requested one when they differ.
const capturedPaise = (payment: IPayment) => payment.gatewayAmountPaise ?? payment.amountPaise;

/**
 * Asks for a refund. Everything is decided under the payment's row lock: the check that the
 * amount still fits (captured, minus already refunded, minus refunds in flight) and the insert
 * happen with nobody else able to change the payment in between, so two requests cannot both
 * claim the same money.
 */
const createRefund = async (input: unknown, actor: Actor, rawKey: unknown) => {
  try {
    const body = parseBody(input);
    requireFields(body, ["paymentId", "amount", "reason"]);
    if (!isUuid(body.paymentId)) throw new CustomException("paymentId must be a valid id.", 400);
    const paymentId = body.paymentId.toLowerCase();
    const amountPaise = rupeesToPaise(body.amount, "amount");
    const reason = text(body.reason, "reason", 500);
    const key = idempotencyKeyOf(rawKey);

    const result = await PaymentQuery.inTransaction(async (tx) => {
      const payment = await PaymentQuery.lockById(paymentId, tx);
      if (!payment) throw new CustomException("Payment not found.", notFound);

      if (key) {
        const earlier = await RefundQuery.findByKey(paymentId, key, tx);
        if (earlier) {
          if (earlier.amountPaise !== amountPaise || earlier.reason !== reason) {
            throw new CustomException("This Idempotency-Key was already used for a different refund.", conflict);
          }
          return earlier;
        }
      }

      if (payment.status !== "captured") {
        throw new CustomException("Only a captured payment can be refunded.", conflict);
      }
      const inFlight = await RefundQuery.sumInFlight(paymentId, tx);
      const refundable = capturedPaise(payment) - payment.refundedPaise - inFlight;
      if (amountPaise > refundable) {
        throw new CustomException(
          `The refund is more than can still be refunded (${toRupees(Math.max(refundable, 0)).toFixed(2)} remaining).`,
          conflict
        );
      }
      return await RefundQuery.create(
        { paymentId, storeId: payment.storeId, amountPaise, reason, idempotencyKey: key ?? null, requestedByUserId: actor.id },
        tx
      );
    });
    return toPublic(result);
  } catch (error) {
    throw toCustomException(error);
  }
};

const listRefunds = async (query: Record<string, unknown>, page: PageRequest): Promise<Page<ReturnType<typeof toPublic>>> => {
  try {
    const status = queryEnum(query.status, REFUND_STATUSES, "status") as RefundStatus | undefined;
    const { from, to } = optionalDayBounds(query);
    const { items, total } = await RefundQuery.search(
      { status, from: from ? istDayStart(from) : undefined, to: to ? istDayEnd(to) : undefined },
      page
    );
    return toPage(items.map(toPublic), total, page);
  } catch (error) {
    throw toCustomException(error);
  }
};

/**
 * Approves a requested refund and sends it to Razorpay. The approval is one guarded statement
 * (requested -> approved), so only one caller wins it. The refund id is Razorpay's idempotency
 * key, so repeating this call after a timeout returns the same gateway refund, never a second.
 * The refund becomes "processed" only when Razorpay's refund.processed webhook arrives.
 */
const approveRefund = async (rawId: string, actor: Actor) => {
  try {
    const id = pathId(rawId, "Refund");
    let refund = await RefundQuery.findById(id);
    if (!refund) throw new CustomException("Refund not found.", notFound);

    // The person who asked for a refund cannot also release it (super_admin excepted).
    if (refund.status === "requested" && refund.requestedByUserId === actor.id && actor.role !== "super_admin") {
      throw new CustomException("Another admin must approve a refund you requested.", forbidden);
    }
    if (refund.status === "requested") {
      const won = await RefundQuery.claimApproval(id, actor.id);
      refund = (await RefundQuery.findById(id)) as IRefund;
      if (!won && refund.status === "requested") throw new CustomException("Refund could not be approved.", conflict);
    }
    if (refund.status === "processed" || (refund.status === "approved" && refund.razorpayRefundId)) {
      return toPublic(refund);
    }
    if (refund.status !== "approved") {
      throw new CustomException(`This refund is ${refund.status} and cannot be approved.`, conflict);
    }

    const payment = await PaymentQuery.findById(refund.paymentId);
    if (!payment?.razorpayPaymentId) throw new CustomException("This payment has no gateway payment to refund.", conflict);

    try {
      const gateway = await PaymentClient.refundPayment(
        payment.razorpayPaymentId,
        refund.amountPaise,
        { refundId: refund.id, orderRef: payment.orderRef.slice(0, 64) },
        refund.id
      );
      refund = await RefundQuery.update(refund.id, { razorpayRefundId: gateway.id });
    } catch (error) {
      if (PaymentClient.isProviderRejection(error)) {
        await RefundQuery.update(refund.id, { status: "failed", failureReason: "Rejected by the payment provider." });
        throw new CustomException("The payment provider rejected this refund.", conflict);
      }
      throw error;
    }
    return toPublic(refund);
  } catch (error) {
    throw toCustomException(error);
  }
};

/**
 * Called inside the webhook transaction after the payment's refundedPaise has been raised. Marks
 * our own refund row processed (when this refund started here) and journals the money leaving.
 */
const confirmFromGateway = async (
  event: { gatewayRefundId: string | null; amountPaise: number },
  payment: IPayment,
  db: Db
): Promise<void> => {
  if (event.amountPaise <= 0) return;
  const own = event.gatewayRefundId ? await RefundQuery.findByGatewayId(event.gatewayRefundId, db) : null;
  if (own && own.status === "approved") {
    await RefundQuery.update(own.id, { status: "processed", processedAt: new Date() }, db);
  }
  await LedgerService.postRefund(
    {
      sourceId: event.gatewayRefundId ?? `${payment.id}:${payment.refundedPaise}`,
      reference: payment.orderRef,
      storeId: payment.storeId,
    },
    event.amountPaise,
    db
  );
};

export const RefundService = { createRefund, listRefunds, approveRefund, confirmFromGateway };
