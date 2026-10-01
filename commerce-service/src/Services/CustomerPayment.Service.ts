import { CustomException } from "../../commons/Exception/CustomException.js";
import { toCustomException } from "../../commons/Exception/ToCustomException.js";
import { parsePage, toPage } from "../../commons/Utils/Pagination.js";
import { conflict, notFound, serviceUnavailable } from "../../commons/Utils/StatusCode.js";
import { SupportClient } from "../Clients/SupportServices.Client.js";
import type { RequestUser } from "../Middleware/Identity.js";
import {
  CustomerPaymentStatus,
  ICustomerPayment,
  PAYMENT_METHOD_HINTS,
} from "../Models/CustomerPayment/CustomerPayment.Interface.js";
import { CustomerPaymentQuery } from "../Queries/CustomerPayment.Query.js";
import { isUniqueViolation } from "../Queries/DatabaseError.js";
import { OrderInternalQuery } from "../Queries/OrderInternal.Query.js";
import { OrderQuery } from "../Queries/Order.Query.js";
import { optionalOneOf, parseBody, text } from "../Utils/Input.js";
import { toRupees } from "../Utils/Money.js";
import { optionalDayQuery, parseIdempotencyKey } from "../Utils/SupportInput.js";
import { customerUserId, findOwnedOrder } from "./CustomerLink.js";
import { derivePaymentStatus } from "./OrderInternal.Service.js";

const CURRENCY = "INR";
const PAYMENT_NOT_FOUND = "Payment not found.";
const MAX_GATEWAY_ID = 200;

// A result only moves an attempt up this ladder, so a late "failed" can never undo a capture.
const RANK: Record<CustomerPaymentStatus, number> = { created: 0, failed: 1, authorized: 2, captured: 3 };

// What finance reports for a payment, as far as the customer's checkout is concerned.
const reachedStatus = (financeStatus: string): CustomerPaymentStatus | null =>
  financeStatus === "captured" || financeStatus === "authorized" || financeStatus === "failed" ? financeStatus : null;

// The contract's label for a part payment.
const contractLabel = (status: "paid" | "unpaid" | "part_paid") => (status === "part_paid" ? "partially_paid" : status);

// What the order has been paid. The account package keeps the running total; an order that
// has none counts as fully paid when marked paid (counter and seeded orders), else as nothing.
const paidOf = (order: { paymentStatus: string; amountPaise: number }, stored: number | null): number =>
  stored ?? (order.paymentStatus === "paid" ? order.amountPaise : 0);

const checkoutView = (p: ICustomerPayment) => ({
  paymentId: p.id,
  razorpayOrderId: p.razorpayOrderId,
  amount: toRupees(p.amountPaise),
  amountPaise: p.amountPaise,
  currency: p.currency,
  keyId: p.keyId,
});

const initiate = async (user: RequestUser, orderId: string, input: unknown, rawKey: unknown) => {
  try {
    const userId = customerUserId(user);
    const method = optionalOneOf(parseBody(input).method, PAYMENT_METHOD_HINTS, "method") ?? null;
    const key = parseIdempotencyKey(rawKey);
    const order = await findOwnedOrder(user, orderId);

    if (key) {
      const prior = await CustomerPaymentQuery.findByKey(userId, key);
      if (prior) {
        if (prior.orderId !== order.id) {
          throw new CustomException("This Idempotency-Key was already used for a different order.", conflict);
        }
        return checkoutView(prior);
      }
    }
    if (order.status === "cancelled") throw new CustomException("A cancelled order cannot be paid.", conflict);
    if (order.paymentStatus === "paid") throw new CustomException("This order is already paid.", conflict);
    // The amount is whatever is still owed on the order in our database, never the client's number.
    const due = order.amountPaise - paidOf(order, await OrderInternalQuery.findPaidPaise(order.id));
    if (due <= 0) throw new CustomException("This order is already paid.", conflict);

    const checkout = await SupportClient.createPaymentOrder({
      orderRef: order.ref,
      amountPaise: due,
      customerUserId: userId,
      ...(key ? { idempotencyKey: `${userId}:${order.id}:${key}` } : {}),
    });
    if (checkout.amountPaise !== due) {
      console.error(`[payments] finance returned ${checkout.amountPaise} for ${order.ref}, expected ${due}`);
      throw new CustomException("The payment service could not start this payment. Please try again.", serviceUnavailable);
    }
    try {
      const created = await CustomerPaymentQuery.create({
        orderId: order.id,
        orderRef: order.ref,
        customerUserId: userId,
        amountPaise: due,
        currency: checkout.currency || CURRENCY,
        method,
        financePaymentId: checkout.paymentId,
        razorpayOrderId: checkout.razorpayOrderId,
        keyId: checkout.keyId,
        idempotencyKey: key,
      });
      return checkoutView(created);
    } catch (error) {
      // A simultaneous retry (same key, so finance answered with the same checkout) won the insert.
      if (isUniqueViolation(error)) {
        const raced =
          (key ? await CustomerPaymentQuery.findByKey(userId, key) : null) ??
          (await CustomerPaymentQuery.findOwn(userId, order.id, checkout.razorpayOrderId));
        if (raced) return checkoutView(raced);
      }
      throw error;
    }
  } catch (error) {
    throw toCustomException(error);
  }
};

const orderPaymentView = async (orderId: string) => {
  const order = await OrderInternalQuery.findOrder(orderId);
  if (!order) throw new CustomException("Order not found.", notFound);
  const paid = paidOf(order, await OrderInternalQuery.findPaidPaise(orderId));
  return { paymentStatus: order.paymentStatus, paid, due: Math.max(0, order.amountPaise - paid) };
};

const verify = async (user: RequestUser, orderId: string, input: unknown) => {
  try {
    const userId = customerUserId(user);
    const body = parseBody(input);
    const razorpayOrderId = text(body.razorpayOrderId, "razorpayOrderId", MAX_GATEWAY_ID);
    const razorpayPaymentId = text(body.razorpayPaymentId, "razorpayPaymentId", MAX_GATEWAY_ID);
    const razorpaySignature = text(body.razorpaySignature, "razorpaySignature", MAX_GATEWAY_ID);
    const order = await findOwnedOrder(user, orderId);

    // Only the customer's own attempt for this very order can be verified.
    const attempt = await CustomerPaymentQuery.findOwn(userId, order.id, razorpayOrderId);
    if (!attempt) throw new CustomException(PAYMENT_NOT_FOUND, notFound);

    let status = attempt.status;
    if (attempt.status !== "captured") {
      const result = await SupportClient.verifyPayment({ razorpayOrderId, razorpayPaymentId, razorpaySignature });
      if (result.orderRef !== attempt.orderRef || result.amountPaise !== attempt.amountPaise) {
        console.error(`[payments] verify mismatch for ${attempt.orderRef}: finance said ${result.orderRef} ${result.amountPaise}`);
        throw new CustomException("This payment does not match the order.", conflict);
      }
      status = await settle(attempt, reachedStatus(result.status), razorpayPaymentId, result.paymentId);
    }

    const view = await orderPaymentView(order.id);
    return {
      paymentStatus: contractLabel(view.paymentStatus),
      payment: { id: attempt.id, status },
      amountPaid: toRupees(view.paid),
      amountDue: toRupees(view.due),
    };
  } catch (error) {
    throw toCustomException(error);
  }
};

// Records the gateway's verdict on an attempt and, for a capture, adds the money to the order
// in the same transaction. The attempt row is locked first: a repeated or simultaneous verify
// finds it already captured and adds nothing, so the amount is counted exactly once. The
// order's paid total and label then move exactly as the account package's payment-status
// endpoint moves them: one-way, never above the order amount.
const settle = async (
  attempt: ICustomerPayment,
  reached: CustomerPaymentStatus | null,
  razorpayPaymentId: string,
  financePaymentId: string
): Promise<CustomerPaymentStatus> =>
  await CustomerPaymentQuery.inTransaction(async (tx) => {
    const locked = await CustomerPaymentQuery.lock(attempt.id, tx);
    if (!locked) throw new CustomException(PAYMENT_NOT_FOUND, notFound);
    if (!reached || RANK[reached] <= RANK[locked.status]) return locked.status;

    await CustomerPaymentQuery.update(
      attempt.id,
      {
        status: reached,
        razorpayPaymentId,
        financePaymentId,
        ...(reached === "captured" ? { paidAt: new Date() } : {}),
      },
      tx
    );
    if (reached === "captured") {
      if (!(await OrderQuery.lockById(attempt.orderId, null, tx))) throw new CustomException("Order not found.", notFound);
      const order = await OrderInternalQuery.findOrder(attempt.orderId, tx);
      if (!order) throw new CustomException("Order not found.", notFound);
      const stored = await OrderInternalQuery.findPaidPaise(order.id, tx);
      const current = paidOf(order, stored);
      // Capped at the order amount: an overpayment is finance's to refund, not ours to record.
      const paid = Math.min(order.amountPaise, current + attempt.amountPaise);
      if (stored === null || paid !== stored) await OrderInternalQuery.upsertPaidPaise(order.id, paid, tx);
      const label = derivePaymentStatus(paid, order.amountPaise);
      if (label !== order.paymentStatus) await OrderInternalQuery.setPaymentStatus(order.id, label, tx);
    }
    return reached;
  });

const listMine = async (user: RequestUser, query: Record<string, unknown>) => {
  try {
    const userId = customerUserId(user);
    const page = parsePage(query);
    const { items, total } = await CustomerPaymentQuery.search({
      customerUserId: userId,
      from: optionalDayQuery(query.from, "from", false),
      to: optionalDayQuery(query.to, "to", true),
      page,
    });
    return toPage(
      items.map((p) => ({
        id: p.id,
        orderId: p.orderId,
        orderRef: p.orderRef,
        amount: toRupees(p.amountPaise),
        method: p.method,
        status: p.status,
        paidAt: p.paidAt ? p.paidAt.toISOString() : null,
      })),
      total,
      page
    );
  } catch (error) {
    throw toCustomException(error);
  }
};

export const CustomerPaymentService = { initiate, verify, listMine };
