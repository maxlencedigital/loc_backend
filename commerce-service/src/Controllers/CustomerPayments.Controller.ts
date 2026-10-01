import { Response } from "express";
import { handleErrorResponse, handleSuccessResponse } from "../../commons/Response/Response.js";
import { created, successCode } from "../../commons/Utils/StatusCode.js";
import { IdentifiedRequest, RequestUser } from "../Middleware/Identity.js";
import { CustomerPaymentService } from "../Services/CustomerPayment.Service.js";
import { PaymentMethodService } from "../Services/PaymentMethod.Service.js";

const who = (req: IdentifiedRequest) => req.user as RequestUser;

/**
 * @openapi
 * /me/orders/{id}/payment/initiate:
 *   post:
 *     operationId: initiateMyPayment
 *     summary: "Start an online payment for an order"
 *     description: "**Who can call this:** customer. Creates the Razorpay order the app then opens checkout with. The amount is what is still owed on the order in our database, never a number from the client. An already paid or cancelled order is refused (409); someone else's order is a 404. Send an Idempotency-Key header to make a retry return the same checkout. If the payment service is down the answer is 503 and nothing is recorded."
 *     tags: ["Customer - Payments"]
 *     x-roles: [customer]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               method: { type: string, enum: [card, upi, netbanking, wallet] }
 *     responses:
 *       200:
 *         description: "OK."
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     result:
 *                       type: object
 *                       properties:
 *                         paymentId: { type: string, format: uuid }
 *                         razorpayOrderId: { type: string }
 *                         amount: { type: number, description: "Amount in INR" }
 *                         amountPaise: { type: integer }
 *                         currency: { type: string }
 *                         keyId: { type: string }
 *       400:
 *         description: "Invalid fields."
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: "Order not found (or not yours)."
 *       409:
 *         description: "The order is already paid or cancelled."
 *       503:
 *         description: "The payment service is unavailable."
 */
const initiateMyPayment = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await CustomerPaymentService.initiate(who(req), req.params.id as string, req.body, req.header("idempotency-key"));
    return handleSuccessResponse({ statusCode: successCode, result }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /me/orders/{id}/payment/verify:
 *   post:
 *     operationId: verifyMyPayment
 *     summary: "Confirm a completed payment with the gateway's signature"
 *     description: "**Who can call this:** customer. Only a checkout this customer started for this order can be verified (otherwise 404). The payment service checks the signature; a captured payment is added to the order's paid total once, however many times this is called. paymentStatus uses the contract names (partially_paid for a part payment)."
 *     tags: ["Customer - Payments"]
 *     x-roles: [customer]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
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
 *         description: "OK."
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     result:
 *                       type: object
 *                       properties:
 *                         paymentStatus: { type: string, enum: [unpaid, paid, partially_paid] }
 *                         payment:
 *                           type: object
 *                           properties:
 *                             id: { type: string, format: uuid }
 *                             status: { type: string, enum: [created, authorized, captured, failed] }
 *                         amountPaid: { type: number, description: "Amount in INR" }
 *                         amountDue: { type: number, description: "Amount in INR" }
 *       400:
 *         description: "Missing or invalid fields, or the signature was refused."
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: "Order or checkout not found (or not yours)."
 *       409:
 *         description: "The payment does not match the order."
 *       503:
 *         description: "The payment service is unavailable; nothing was recorded."
 */
const verifyMyPayment = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await CustomerPaymentService.verify(who(req), req.params.id as string, req.body);
    return handleSuccessResponse({ statusCode: successCode, result }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /me/payment-methods:
 *   get:
 *     operationId: listMyPaymentMethods
 *     summary: "My saved payment methods"
 *     description: "**Who can call this:** customer. Masked display details only; the gateway token is never returned. The default method comes first."
 *     tags: ["Customer - Payments"]
 *     x-roles: [customer]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, description: "1-based page number" }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, description: "page size, max 100" }
 *     responses:
 *       200:
 *         description: "OK."
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     result:
 *                       type: object
 *                       properties:
 *                         items:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               id: { type: string, format: uuid }
 *                               type: { type: string, enum: [card, upi] }
 *                               label: { type: string }
 *                               brand: { type: string, nullable: true }
 *                               last4: { type: string, nullable: true }
 *                               isDefault: { type: boolean }
 *                         page: { type: integer }
 *                         limit: { type: integer }
 *                         total: { type: integer }
 *       403:
 *         description: Your role is not allowed to call this.
 */
const listMyPaymentMethods = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await PaymentMethodService.listMine(who(req), req.query) }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /me/payment-methods:
 *   post:
 *     operationId: addMyPaymentMethod
 *     summary: "Save a payment method from a gateway token"
 *     description: "**Who can call this:** customer. Stores only the gateway's token reference and masked display text (type, brand, last4, label). Anything that looks like a card number is refused (400). Saving the same token again returns the saved method (200). The first method becomes the default; at most 10 are kept."
 *     tags: ["Customer - Payments"]
 *     x-roles: [customer]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [gatewayToken]
 *             properties:
 *               gatewayToken: { type: string, description: "The gateway's token reference, never a card number" }
 *               isDefault: { type: boolean }
 *               type: { type: string, enum: [card, upi], default: card }
 *               brand: { type: string, maxLength: 20 }
 *               last4: { type: string, description: "Exactly 4 digits" }
 *               label: { type: string, maxLength: 40 }
 *     responses:
 *       201:
 *         description: "Created."
 *       200:
 *         description: "That token was already saved."
 *       400:
 *         description: "Missing or invalid fields, or a card number was sent."
 *       403:
 *         description: Your role is not allowed to call this.
 *       409:
 *         description: "Too many saved methods, or the default changed at the same moment."
 */
const addMyPaymentMethod = async (req: IdentifiedRequest, res: Response) => {
  try {
    const outcome = await PaymentMethodService.add(who(req), req.body);
    return handleSuccessResponse(
      { statusCode: outcome.created ? created : successCode, result: outcome.data },
      res,
      outcome.created ? "Payment method saved." : "Payment method already saved."
    );
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /me/payment-methods/{id}:
 *   delete:
 *     operationId: removeMyPaymentMethod
 *     summary: "Remove a saved payment method"
 *     description: "**Who can call this:** customer. Only the caller's own method (404 otherwise). Removing the default hands the role to the newest remaining method."
 *     tags: ["Customer - Payments"]
 *     x-roles: [customer]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: "OK."
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: "Not found (or not yours)."
 */
const removeMyPaymentMethod = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await PaymentMethodService.remove(who(req), req.params.id as string);
    return handleSuccessResponse({ statusCode: successCode, result }, res, "Payment method removed.");
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /me/payments:
 *   get:
 *     operationId: listMyPayments
 *     summary: "My payment history"
 *     description: "**Who can call this:** customer. Only the caller's own payments that reached a result (authorized, captured or failed), newest first."
 *     tags: ["Customer - Payments"]
 *     x-roles: [customer]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, description: "1-based page number" }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, description: "page size, max 100" }
 *       - in: query
 *         name: from
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: to
 *         schema: { type: string, format: date }
 *     responses:
 *       200:
 *         description: "OK."
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     result:
 *                       type: object
 *                       properties:
 *                         items:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               id: { type: string, format: uuid }
 *                               orderId: { type: string, format: uuid }
 *                               orderRef: { type: string }
 *                               amount: { type: number, description: "Amount in INR" }
 *                               method: { type: string, nullable: true }
 *                               status: { type: string, enum: [authorized, captured, failed] }
 *                               paidAt: { type: string, format: date-time, nullable: true }
 *                         page: { type: integer }
 *                         limit: { type: integer }
 *                         total: { type: integer }
 *       400:
 *         description: "Invalid filter."
 *       403:
 *         description: Your role is not allowed to call this.
 */
const listMyPayments = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await CustomerPaymentService.listMine(who(req), req.query) }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

export const CustomerPaymentsController = {
  initiateMyPayment,
  verifyMyPayment,
  listMyPaymentMethods,
  addMyPaymentMethod,
  removeMyPaymentMethod,
  listMyPayments,
};
