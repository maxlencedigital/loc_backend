import { Response } from "express";
import { IdentifiedRequest } from "../Middleware/Identity.js";
import { actorOf } from "../Middleware/StoreScope.js";
import { handleErrorResponse, handleSuccessResponse } from "../../commons/Response/Response.js";
import { parsePage } from "../../commons/Utils/Pagination.js";
import { created, successCode } from "../../commons/Utils/StatusCode.js";
import { PaymentAdminService } from "../Services/PaymentAdmin.Service.js";
import { RefundService } from "../Services/Refund.Service.js";
import { MAX_STATEMENT_BYTES, ReconciliationService } from "../Services/Reconciliation.Service.js";
import { readMultipart } from "../Utils/Multipart.js";

/**
 * @openapi
 * /payments:
 *   get:
 *     operationId: listPayments
 *     summary: "Payments across stores"
 *     description: "**Who can call this:** admin (super_admin always allowed)."
 *     tags: ["Admin - Payments & Reconciliation"]
 *     x-roles: [admin]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, description: "1-based page number" }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, description: "page size, max 100" }
 *       - in: query
 *         name: storeId
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [created, captured, failed, refunded] }
 *       - in: query
 *         name: method
 *         schema: { type: string }
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
 *                               amount: { type: number, description: "Amount in INR" }
 *                               method: { type: string }
 *                               status: { type: string }
 *                               capturedAt: { type: string, format: date-time }
 *                         page: { type: integer }
 *                         limit: { type: integer }
 *                         total: { type: integer }
 *       403:
 *         description: Your role is not allowed to call this.
 */
const listPayments = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await PaymentAdminService.listPayments(req.query as Record<string, unknown>, actorOf(req), parsePage(req.query as Record<string, unknown>));
    return handleSuccessResponse({ statusCode: successCode, result }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /payments/mismatches/{id}/resolve:
 *   post:
 *     operationId: resolvePaymentMismatch
 *     summary: "Settle a payment flagged for manual review"
 *     description: "**Who can call this:** admin (super_admin always allowed)."
 *     tags: ["Admin - Payments & Reconciliation"]
 *     x-roles: [admin]
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
 *             required: [resolution, note]
 *             properties:
 *               resolution: { type: string, enum: [matched, refunded, written_off, manual_adjust] }
 *               note: { type: string }
 *     responses:
 *       200:
 *         description: "OK."
 *       400:
 *         description: "Missing or invalid fields."
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 */
const resolvePaymentMismatch = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await PaymentAdminService.resolveMismatch(req.params.id as string, req.body, actorOf(req));
    return handleSuccessResponse({ statusCode: successCode, result }, res, "Mismatch resolved.");
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /payments/{id}:
 *   get:
 *     operationId: getPayment
 *     summary: "One payment"
 *     description: "**Who can call this:** admin (super_admin always allowed)."
 *     tags: ["Admin - Payments & Reconciliation"]
 *     x-roles: [admin]
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
 *         description: Not found.
 */
const getPayment = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await PaymentAdminService.getPayment(req.params.id as string, actorOf(req));
    return handleSuccessResponse({ statusCode: successCode, result }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /reconciliation/bank-statements:
 *   post:
 *     operationId: uploadBankStatement
 *     summary: "Upload a bank statement to reconcile against"
 *     description: "**Who can call this:** admin (super_admin always allowed). Multipart."
 *     tags: ["Admin - Payments & Reconciliation"]
 *     x-roles: [admin]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [file]
 *             properties:
 *               file: { type: string, format: binary }
 *               bank: { type: string }
 *     responses:
 *       201:
 *         description: "Created."
 *       400:
 *         description: "Missing or invalid fields."
 *       403:
 *         description: Your role is not allowed to call this.
 */
const uploadBankStatement = async (req: IdentifiedRequest, res: Response) => {
  try {
    const upload = await readMultipart(req, MAX_STATEMENT_BYTES + 16_384);
    const file = upload.files.find((f) => f.field === "file");
    const result = await ReconciliationService.uploadStatement(file, upload.fields, actorOf(req));
    return handleSuccessResponse({ statusCode: created, result }, res, "Bank statement uploaded.");
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /reconciliation/runs:
 *   post:
 *     operationId: createReconciliationRun
 *     summary: "Reconcile a period against the bank or the payment provider"
 *     description: "**Who can call this:** admin (super_admin always allowed)."
 *     tags: ["Admin - Payments & Reconciliation"]
 *     x-roles: [admin]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [from, to]
 *             properties:
 *               from: { type: string, format: date }
 *               to: { type: string, format: date }
 *               source: { type: string, enum: [bank, razorpay] }
 *     responses:
 *       201:
 *         description: "Created."
 *       400:
 *         description: "Missing or invalid fields."
 *       403:
 *         description: Your role is not allowed to call this.
 */
const createReconciliationRun = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await ReconciliationService.createRun(req.body, actorOf(req));
    return handleSuccessResponse({ statusCode: created, result }, res, "Reconciliation run completed.");
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /reconciliation/runs:
 *   get:
 *     operationId: listReconciliationRuns
 *     summary: "Past reconciliation runs"
 *     description: "**Who can call this:** admin (super_admin always allowed)."
 *     tags: ["Admin - Payments & Reconciliation"]
 *     x-roles: [admin]
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
 *                               from: { type: string, format: date }
 *                               to: { type: string, format: date }
 *                               source: { type: string }
 *                               matched: { type: integer }
 *                               exceptions: { type: integer }
 *                               ranAt: { type: string, format: date-time }
 *                         page: { type: integer }
 *                         limit: { type: integer }
 *                         total: { type: integer }
 *       403:
 *         description: Your role is not allowed to call this.
 */
const listReconciliationRuns = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await ReconciliationService.listRuns(parsePage(req.query as Record<string, unknown>));
    return handleSuccessResponse({ statusCode: successCode, result }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /reconciliation/runs/{id}:
 *   get:
 *     operationId: getReconciliationRun
 *     summary: "One reconciliation run"
 *     description: "**Who can call this:** admin (super_admin always allowed)."
 *     tags: ["Admin - Payments & Reconciliation"]
 *     x-roles: [admin]
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
 *         description: Not found.
 */
const getReconciliationRun = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await ReconciliationService.getRun(req.params.id as string);
    return handleSuccessResponse({ statusCode: successCode, result }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /reconciliation/runs/{id}/exceptions:
 *   get:
 *     operationId: listReconciliationExceptions
 *     summary: "What did not match in a run"
 *     description: "**Who can call this:** admin (super_admin always allowed)."
 *     tags: ["Admin - Payments & Reconciliation"]
 *     x-roles: [admin]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
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
 *                         exceptions:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               id: { type: string, format: uuid }
 *                               reference: { type: string }
 *                               expected: { type: number, description: "Amount in INR" }
 *                               actual: { type: number, description: "Amount in INR" }
 *                               reason: { type: string }
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 */
const listReconciliationExceptions = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await ReconciliationService.listExceptions(req.params.id as string);
    return handleSuccessResponse({ statusCode: successCode, result }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /refunds:
 *   post:
 *     operationId: createRefund
 *     summary: "Refund a payment"
 *     description: "**Who can call this:** admin (super_admin always allowed). Asks for a refund, which another admin then approves; the amount cannot exceed what was captured minus what is already refunded or in flight. Idempotent through the Idempotency-Key header."
 *     tags: ["Admin - Payments & Reconciliation"]
 *     x-roles: [admin]
 *     parameters:
 *       - in: header
 *         name: Idempotency-Key
 *         required: false
 *         schema: { type: string, maxLength: 128 }
 *         description: "A retry with the same key returns the first result instead of creating a second record."
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [paymentId, amount, reason]
 *             properties:
 *               paymentId: { type: string, format: uuid }
 *               amount: { type: number, description: "Amount in INR" }
 *               reason: { type: string }
 *     responses:
 *       201:
 *         description: "Created."
 *       400:
 *         description: "Missing or invalid fields."
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Payment not found.
 *       409:
 *         description: "The payment is not captured, the amount is more than can be refunded, or the key was used for a different refund."
 */
const createRefund = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await RefundService.createRefund(req.body, actorOf(req), req.header("idempotency-key"));
    return handleSuccessResponse({ statusCode: created, result }, res, "Refund requested.");
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /refunds:
 *   get:
 *     operationId: listRefunds
 *     summary: "Refunds"
 *     description: "**Who can call this:** admin (super_admin always allowed)."
 *     tags: ["Admin - Payments & Reconciliation"]
 *     x-roles: [admin]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, description: "1-based page number" }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, description: "page size, max 100" }
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [requested, approved, processed, failed] }
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
 *                               paymentId: { type: string, format: uuid }
 *                               amount: { type: number, description: "Amount in INR" }
 *                               status: { type: string }
 *                               reason: { type: string }
 *                         page: { type: integer }
 *                         limit: { type: integer }
 *                         total: { type: integer }
 *       403:
 *         description: Your role is not allowed to call this.
 */
const listRefunds = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await RefundService.listRefunds(req.query as Record<string, unknown>, parsePage(req.query as Record<string, unknown>));
    return handleSuccessResponse({ statusCode: successCode, result }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /refunds/{id}/approve:
 *   post:
 *     operationId: approveRefund
 *     summary: "Approve a refund for processing"
 *     description: "**Who can call this:** admin (super_admin always allowed)."
 *     tags: ["Admin - Payments & Reconciliation"]
 *     x-roles: [admin]
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
 *         description: Not found.
 */
const approveRefund = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await RefundService.approveRefund(req.params.id as string, actorOf(req));
    return handleSuccessResponse({ statusCode: successCode, result }, res, "Refund approved.");
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

export const AdminPaymentsController = {
  listPayments,
  resolvePaymentMismatch,
  getPayment,
  uploadBankStatement,
  createReconciliationRun,
  listReconciliationRuns,
  getReconciliationRun,
  listReconciliationExceptions,
  createRefund,
  listRefunds,
  approveRefund,
};
