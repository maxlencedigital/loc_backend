import { CustomException } from "../../commons/Exception/CustomException.js";
import { toCustomException } from "../../commons/Exception/ToCustomException.js";
import { Page, PageRequest, toPage } from "../../commons/Utils/Pagination.js";
import { requireFields } from "../../commons/Utils/Validation.js";
import { conflict, notFound } from "../../commons/Utils/StatusCode.js";
import { Actor, effectiveStore, scopeOf } from "../Middleware/StoreScope.js";
import { IMismatch, IPayment, MismatchResolution, PaymentStatus } from "../Models/Payment/Payment.Interface.js";
import { PaymentQuery } from "../Queries/Payment.Query.js";
import { istDayEnd, istDayStart, optionalDayBounds } from "../Utils/Dates.js";
import { oneOf, parseBody, pathId, queryEnum, queryString, queryUuid, text } from "../Utils/Input.js";
import { toRupees } from "../Utils/Money.js";

const STATUSES: readonly PaymentStatus[] = ["created", "authorized", "captured", "failed", "refunded"];
const RESOLUTIONS: readonly MismatchResolution[] = ["matched", "refunded", "written_off", "manual_adjust"];
const MISMATCH_STATUSES = ["open", "resolved"] as const;

// orderId is the commerce order reference (a string like "LOC-000123"), not a uuid: the field
// keeps the catalogue's name and orderRef says what it really is.
const toListItem = (payment: IPayment) => ({
  id: payment.id,
  orderId: payment.orderRef,
  orderRef: payment.orderRef,
  amount: toRupees(payment.amountPaise),
  method: payment.method,
  status: payment.status,
  capturedAt: payment.capturedAt,
});

const listPayments = async (
  query: Record<string, unknown>,
  actor: Actor,
  page: PageRequest
): Promise<Page<ReturnType<typeof toListItem>>> => {
  try {
    const storeId = effectiveStore(actor, queryUuid(query.storeId, "storeId")) ?? undefined;
    const status = queryEnum(query.status, STATUSES, "status");
    const method = queryString(query.method, "method");
    if (method && method.length > 30) throw new CustomException("method is too long.", 400);
    const { from, to } = optionalDayBounds(query);
    const { items, total } = await PaymentQuery.search(
      {
        storeId,
        status,
        method,
        from: from ? istDayStart(from) : undefined,
        to: to ? istDayEnd(to) : undefined,
      },
      page
    );
    return toPage(items.map(toListItem), total, page);
  } catch (error) {
    throw toCustomException(error);
  }
};

const getPayment = async (rawId: string, actor: Actor) => {
  try {
    const id = pathId(rawId, "Payment");
    const payment = await PaymentQuery.findById(id);
    // A payment of another store is not found, the same answer as one that does not exist.
    const scope = scopeOf(actor);
    if (!payment || (scope && payment.storeId !== scope)) throw new CustomException("Payment not found.", notFound);
    return {
      ...toListItem(payment),
      amountPaise: payment.amountPaise,
      currency: payment.currency,
      refundedAmount: toRupees(payment.refundedPaise),
      storeId: payment.storeId,
      razorpayOrderId: payment.razorpayOrderId,
      razorpayPaymentId: payment.razorpayPaymentId,
      amountMismatch: payment.amountMismatch,
      gatewayAmount: payment.gatewayAmountPaise === null ? null : toRupees(payment.gatewayAmountPaise),
      createdAt: payment.createdAt,
    };
  } catch (error) {
    throw toCustomException(error);
  }
};

const toMismatchItem = ({ payment, resolution }: IMismatch) => ({
  id: payment.id,
  orderId: payment.orderRef,
  expectedAmount: toRupees(payment.amountPaise),
  gatewayAmount: payment.gatewayAmountPaise === null ? null : toRupees(payment.gatewayAmountPaise),
  gatewayTransactionId: payment.razorpayPaymentId,
  flaggedAt: payment.capturedAt ?? payment.createdAt,
  status: resolution ? "resolved" : "open",
  resolution: resolution?.resolution ?? null,
});

const listMismatches = async (
  query: Record<string, unknown>,
  actor: Actor,
  page: PageRequest
): Promise<Page<ReturnType<typeof toMismatchItem>>> => {
  try {
    const status = queryEnum(query.status, MISMATCH_STATUSES, "status");
    const { items, total } = await PaymentQuery.searchMismatches(status, scopeOf(actor), page);
    return toPage(items.map(toMismatchItem), total, page);
  } catch (error) {
    throw toCustomException(error);
  }
};

// The decision is recorded once and never edited. It does not move money: "refunded" says a
// refund was handled through POST /refunds, it does not issue one.
const resolveMismatch = async (rawId: string, input: unknown, actor: Actor) => {
  try {
    const id = pathId(rawId, "Mismatch");
    const body = parseBody(input);
    requireFields(body, ["resolution", "note"]);
    const resolution = oneOf(body.resolution, RESOLUTIONS, "resolution");
    const note = text(body.note, "note", 1000);

    const mismatch = await PaymentQuery.findMismatch(id, scopeOf(actor));
    if (!mismatch) throw new CustomException("Mismatch not found.", notFound);
    if (mismatch.resolution) throw new CustomException("This mismatch has already been resolved.", conflict);

    const written = await PaymentQuery.createResolution({
      paymentId: id,
      resolution,
      note,
      resolvedByUserId: actor.id,
      resolvedByName: actor.name,
    });
    // The unique paymentId decided a race between two admins: the loser is told it is resolved.
    if (!written) throw new CustomException("This mismatch has already been resolved.", conflict);
    return { id, status: "resolved", resolution, note, resolvedBy: actor.name ?? actor.id, resolvedAt: new Date() };
  } catch (error) {
    throw toCustomException(error);
  }
};

export const PaymentAdminService = { listPayments, getPayment, listMismatches, resolveMismatch };
