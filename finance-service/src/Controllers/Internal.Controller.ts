import { Request, Response } from "express";
import { handleErrorResponse, handleSuccessResponse } from "../../commons/Response/Response.js";
import { created, successCode } from "../../commons/Utils/StatusCode.js";
import { CashService } from "../Services/Cash.Service.js";
import { PaymentService } from "../Services/Payment.Service.js";
import { ReceivableService } from "../Services/Receivable.Service.js";
import { parseBody } from "../Utils/Input.js";

// Service-to-service endpoints (behind requireServiceCall). No user, so no role: each one does
// only what the calling service legitimately needs and validates its input like a public route.

/**
 * @openapi
 * /internal/payments:
 *   get:
 *     operationId: internalListPayments
 *     summary: "Payments for one order (service to service)"
 *     description: "Internal. The newest 50 payments recorded for an order reference."
 *     tags: ["Internal - Finance"]
 *     parameters:
 *       - in: query
 *         name: orderRef
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: "{ payments: [...] }"
 *       400:
 *         description: "orderRef missing or invalid."
 */
const listPayments = async (req: Request, res: Response) => {
  try {
    const orderRef = typeof req.query.orderRef === "string" ? req.query.orderRef : undefined;
    const result = await PaymentService.listForOrder(orderRef);
    return handleSuccessResponse({ statusCode: successCode, result }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /internal/payments/orders:
 *   post:
 *     operationId: internalCreatePaymentOrder
 *     summary: "Start a checkout for a customer's order (service to service)"
 *     description: "Internal. Commerce prices the order and calls this. Same amount limits and already-paid refusal as the staff route; the Idempotency-Key header (or body idempotencyKey) makes a retry return the first checkout. Owned by the customer id."
 *     tags: ["Internal - Finance"]
 *     parameters:
 *       - in: header
 *         name: Idempotency-Key
 *         required: false
 *         schema: { type: string, maxLength: 128 }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [orderRef, amountPaise, customerUserId]
 *             properties:
 *               orderRef: { type: string }
 *               amountPaise: { type: integer }
 *               customerUserId: { type: string, format: uuid }
 *               storeId: { type: string, format: uuid }
 *               idempotencyKey: { type: string }
 *     responses:
 *       201:
 *         description: "{ paymentId, razorpayOrderId, amountPaise, currency, keyId }"
 *       400:
 *         description: "Missing or invalid fields."
 *       409:
 *         description: "The order is already paid, or the key was used for a different payment."
 *       503:
 *         description: "The payment provider is unreachable."
 */
const createPaymentOrder = async (req: Request, res: Response) => {
  try {
    const result = await PaymentService.createInternalCheckout(parseBody(req.body), req.header("idempotency-key"));
    return handleSuccessResponse({ statusCode: created, result }, res, "Payment order created.");
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /internal/payments/verify:
 *   post:
 *     operationId: internalVerifyPayment
 *     summary: "Confirm a completed Checkout (service to service)"
 *     description: "Internal. Checks Razorpay's signature, then reads the real status from Razorpay. When customerUserId is sent, another customer's payment is answered 404."
 *     tags: ["Internal - Finance"]
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
 *               customerUserId: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: "{ paymentId, orderRef, status, amountPaise }"
 *       400:
 *         description: "Missing fields or an invalid signature."
 *       404:
 *         description: "No such payment."
 */
const verifyPayment = async (req: Request, res: Response) => {
  try {
    const body = parseBody(req.body);
    const customer = typeof body.customerUserId === "string" ? body.customerUserId.toLowerCase() : undefined;
    const confirmed = await PaymentService.confirmCheckout(body, customer);
    const result = {
      paymentId: confirmed.paymentId,
      orderRef: confirmed.orderRef,
      status: confirmed.status,
      amountPaise: confirmed.amountPaise,
    };
    return handleSuccessResponse({ statusCode: successCode, result }, res, "Payment verified.");
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /internal/receivables:
 *   post:
 *     operationId: internalRegisterReceivable
 *     summary: "Register an invoice raised on credit (service to service)"
 *     description: "Internal. Idempotent on invoiceId. Contact details are kept only to send reminders and are never returned."
 *     tags: ["Internal - Finance"]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [invoiceId, customerId, storeId, amountPaise, dueOn]
 *             properties:
 *               invoiceId: { type: string, format: uuid }
 *               customerId: { type: string, format: uuid }
 *               storeId: { type: string, format: uuid }
 *               orderRef: { type: string }
 *               amountPaise: { type: integer }
 *               dueOn: { type: string, format: date }
 *               contactPhone: { type: string }
 *               contactEmail: { type: string }
 *     responses:
 *       201:
 *         description: "Registered."
 *       200:
 *         description: "Already registered (same invoice and amount)."
 *       400:
 *         description: "Missing or invalid fields."
 *       409:
 *         description: "The invoice is registered with a different amount."
 */
const registerReceivable = async (req: Request, res: Response) => {
  try {
    const result = await ReceivableService.registerFromCommerce(req.body);
    return handleSuccessResponse({ statusCode: result.created ? created : successCode, result }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /internal/cash/day-close:
 *   post:
 *     operationId: internalRegisterDayClose
 *     summary: "Report a store's day close (service to service)"
 *     description: "Internal. One close per store and day. Repeating the same figures is a no-op; different figures answer 409. A counted amount that differs from the expected one opens a cash variance."
 *     tags: ["Internal - Finance"]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [storeId, date, expectedPaise, countedPaise, closedByName]
 *             properties:
 *               storeId: { type: string, format: uuid }
 *               storeName: { type: string }
 *               date: { type: string, format: date }
 *               expectedPaise: { type: integer }
 *               countedPaise: { type: integer }
 *               closedByName: { type: string }
 *               closedByUserId: { type: string }
 *     responses:
 *       201:
 *         description: "Closed."
 *       200:
 *         description: "Already closed with the same figures."
 *       400:
 *         description: "Missing or invalid fields."
 *       409:
 *         description: "Already closed with different figures."
 */
const registerDayClose = async (req: Request, res: Response) => {
  try {
    const result = await CashService.registerDayClose(req.body);
    return handleSuccessResponse({ statusCode: result.created ? created : successCode, result }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /internal/cash/deposits:
 *   post:
 *     operationId: internalRegisterCashDeposit
 *     summary: "Report cash taken to the bank (service to service)"
 *     description: "Internal. The day must already be closed and deposits may not exceed the cash counted. An Idempotency-Key (header or body idempotencyKey) is required so a retry cannot bank twice."
 *     tags: ["Internal - Finance"]
 *     parameters:
 *       - in: header
 *         name: Idempotency-Key
 *         required: false
 *         schema: { type: string, maxLength: 128 }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [storeId, date, amountPaise]
 *             properties:
 *               storeId: { type: string, format: uuid }
 *               date: { type: string, format: date }
 *               amountPaise: { type: integer }
 *               reference: { type: string }
 *               idempotencyKey: { type: string }
 *     responses:
 *       201:
 *         description: "Recorded."
 *       200:
 *         description: "Already recorded (replay)."
 *       400:
 *         description: "Missing or invalid fields."
 *       409:
 *         description: "The day is not closed, or the deposits would exceed the cash counted."
 */
const registerDeposit = async (req: Request, res: Response) => {
  try {
    const result = await CashService.registerDeposit(req.body, req.header("idempotency-key"));
    return handleSuccessResponse({ statusCode: result.created ? created : successCode, result }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

export const InternalController = {
  listPayments,
  createPaymentOrder,
  verifyPayment,
  registerReceivable,
  registerDayClose,
  registerDeposit,
};
