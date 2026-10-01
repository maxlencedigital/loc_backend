import { Response } from "express";
import { IdentifiedRequest } from "../Middleware/Identity.js";
import { handleErrorResponse, handleSuccessResponse } from "../../commons/Response/Response.js";
import { parsePage } from "../../commons/Utils/Pagination.js";
import { actorOf, resolveStoreScope } from "../Middleware/StoreScope.js";
import { created, successCode } from "../../commons/Utils/StatusCode.js";
import { PaymentService } from "../Services/Payment.Service.js";
import { PaymentAdminService } from "../Services/PaymentAdmin.Service.js";

/**
 * @openapi
 * /payments/orders:
 *   post:
 *     operationId: createPaymentOrder
 *     summary: Create a Razorpay order to pay for an order
 *     description: >
 *       **Who can call this:** admin, manager, staff (super_admin always allowed).
 *       Server-side call: the amount is NOT taken from a customer, it comes from the
 *       order the caller has already priced. Returns what the app needs to open
 *       Razorpay Checkout (`razorpayOrderId`, `amountPaise`, `keyId`).
 *     tags: ["Admin - Payments & Reconciliation"]
 *     parameters:
 *       - in: header
 *         name: Idempotency-Key
 *         required: false
 *         schema: { type: string, maxLength: 128 }
 *         description: "A retry with the same key returns the first checkout instead of creating a second Razorpay order."
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [orderRef, amount]
 *             properties:
 *               orderRef: { type: string, description: "The commerce order this pays for" }
 *               amount: { type: number, description: "Amount in INR, e.g. 499.50" }
 *     responses:
 *       201:
 *         description: Razorpay order created.
 *       400:
 *         description: Missing or invalid fields.
 *       409:
 *         description: This order is already paid.
 *       503:
 *         description: The payment provider is unreachable or not configured.
 */
const createOrder = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await PaymentService.createCheckout(req.body, req.user?.id ?? null, {
      storeId: resolveStoreScope(req),
      idempotencyKey: req.header("idempotency-key"),
    });
    return handleSuccessResponse({ statusCode: created, result }, res, "Payment order created.");
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /payments/verify:
 *   post:
 *     operationId: verifyPayment
 *     summary: Confirm a completed Checkout with Razorpay's signature
 *     description: >
 *       **Who can call this:** admin, manager, staff, customer (super_admin always allowed).
 *       Checks the signature Razorpay Checkout returned, then reads the real payment
 *       status from Razorpay. The webhook reaches the same result independently, so
 *       an app that never calls this still ends up correct.
 *     tags: ["Admin - Payments & Reconciliation"]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [razorpayOrderId, razorpayPaymentId, razorpaySignature]
 *             properties:
 *               razorpayOrderId: { type: string }
 *               razorpayPaymentId: { type: string }
 *               razorpaySignature: { type: string }
 *     responses:
 *       200:
 *         description: Payment status after verification.
 *       400:
 *         description: Missing fields or an invalid signature.
 *       404:
 *         description: No such payment.
 */
const verify = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await PaymentService.confirmCheckout(req.body ?? {});
    return handleSuccessResponse({ statusCode: successCode, result }, res, "Payment verified.");
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /payments/mismatches:
 *   get:
 *     summary: List payments flagged for manual review (admin/staff only)
 *     description: >
 *       Payments where the amount the gateway reports differs from the amount requested,
 *       flagged for manual review. A store-bound role sees only its own store's payments.
 *     tags: ["Admin - Payments & Reconciliation"]
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [open, resolved] }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *     responses:
 *       200:
 *         description: >
 *           Paginated list of flagged payment mismatches, each shaped as
 *           { id, orderId, expectedAmount, gatewayAmount, gatewayTransactionId, flaggedAt, status }.
 *       403:
 *         description: Authenticated but not admin/staff.
 */
const listMismatches = async (req: IdentifiedRequest, res: Response) => {
  try {
    const query = req.query as Record<string, unknown>;
    const result = await PaymentAdminService.listMismatches(query, actorOf(req), parsePage(query));
    return handleSuccessResponse({ statusCode: successCode, result }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

export const PaymentController = { createOrder, verify, listMismatches };
