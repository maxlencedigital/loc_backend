import { Response } from "express";
import { IdentifiedRequest } from "../Middleware/Identity.js";
import { actorOf } from "../Middleware/StoreScope.js";
import { handleErrorResponse, handleSuccessResponse } from "../../commons/Response/Response.js";
import { parsePage } from "../../commons/Utils/Pagination.js";
import { created, successCode } from "../../commons/Utils/StatusCode.js";
import { GstService } from "../Services/Gst.Service.js";
import { LedgerService } from "../Services/Ledger.Service.js";
import { ReceivableService } from "../Services/Receivable.Service.js";

/**
 * @openapi
 * /gst/reports:
 *   get:
 *     operationId: listGstReports
 *     summary: "Monthly GST filing reports"
 *     description: "**Who can call this:** admin (super_admin always allowed)."
 *     tags: ["Admin - GST, Receivables & Ledger"]
 *     x-roles: [admin]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, description: "1-based page number" }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, description: "page size, max 100" }
 *       - in: query
 *         name: year
 *         schema: { type: integer }
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
 *                               month: { type: string }
 *                               status: { type: string, enum: [draft, ready, filed] }
 *                               taxable: { type: number, description: "Amount in INR" }
 *                               tax: { type: number, description: "Amount in INR" }
 *                         page: { type: integer }
 *                         limit: { type: integer }
 *                         total: { type: integer }
 *       403:
 *         description: Your role is not allowed to call this.
 */
const listGstReports = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await GstService.listReports(req.query as Record<string, unknown>, parsePage(req.query as Record<string, unknown>));
    return handleSuccessResponse({ statusCode: successCode, result }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /gst/reports/generate:
 *   post:
 *     operationId: generateGstReport
 *     summary: "Generate a month's GST report"
 *     description: "**Who can call this:** admin (super_admin always allowed). One report per month, built from commerce's order figures and the refunds confirmed in the month. Generating again before filing refreshes it; a filed report can never change."
 *     tags: ["Admin - GST, Receivables & Ledger"]
 *     x-roles: [admin]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [month]
 *             properties:
 *               month: { type: string, description: "YYYY-MM" }
 *               storeIds: { type: array, items: { type: string, format: uuid }, description: "Limit the figures to these stores" }
 *               targetStatus: { type: string, enum: [draft, ready, filed], description: "Move the report forward; filing needs a ready report, an ended month and an acknowledgement" }
 *               acknowledgement: { type: string, description: "The filing acknowledgement number, required to file" }
 *     responses:
 *       201:
 *         description: "Created."
 *       400:
 *         description: "Missing or invalid fields."
 *       403:
 *         description: Your role is not allowed to call this.
 */
const generateGstReport = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await GstService.generateReport(req.body, actorOf(req));
    return handleSuccessResponse({ statusCode: created, result }, res, "GST report generated.");
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /gst/reports/{id}:
 *   get:
 *     operationId: getGstReport
 *     summary: "One GST report"
 *     description: "**Who can call this:** admin (super_admin always allowed)."
 *     tags: ["Admin - GST, Receivables & Ledger"]
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
const getGstReport = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await GstService.getReport(req.params.id as string);
    return handleSuccessResponse({ statusCode: successCode, result }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /gst/reports/{id}/export:
 *   get:
 *     operationId: exportGstReport
 *     summary: "Download a GST report for filing"
 *     description: "**Who can call this:** admin (super_admin always allowed). csv and json are supported; xlsx is answered with 400."
 *     tags: ["Admin - GST, Receivables & Ledger"]
 *     x-roles: [admin]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: format
 *         schema: { type: string, enum: [csv, xlsx, json] }
 *     responses:
 *       200:
 *         description: "The file."
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 */
const exportGstReport = async (req: IdentifiedRequest, res: Response) => {
  try {
    const file = await GstService.exportReport(req.params.id as string, req.query as Record<string, unknown>);
    res.setHeader("Content-Type", file.contentType);
    res.setHeader("Content-Disposition", `attachment; filename="${file.fileName}"`);
    return res.status(successCode).send(file.body);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /ledger:
 *   get:
 *     operationId: listLedgerEntries
 *     summary: "The ledger"
 *     description: "**Who can call this:** admin (super_admin always allowed)."
 *     tags: ["Admin - GST, Receivables & Ledger"]
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
 *         name: from
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: to
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: account
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
 *                         items:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               id: { type: string, format: uuid }
 *                               date: { type: string, format: date }
 *                               account: { type: string }
 *                               debit: { type: number, description: "Amount in INR" }
 *                               credit: { type: number, description: "Amount in INR" }
 *                               reference: { type: string }
 *                               storeId: { type: string, format: uuid }
 *                         page: { type: integer }
 *                         limit: { type: integer }
 *                         total: { type: integer }
 *       403:
 *         description: Your role is not allowed to call this.
 */
const listLedgerEntries = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await LedgerService.listEntries(req.query as Record<string, unknown>, parsePage(req.query as Record<string, unknown>));
    return handleSuccessResponse({ statusCode: successCode, result }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /ledger/summary:
 *   get:
 *     operationId: getLedgerSummary
 *     summary: "Ledger totals by account"
 *     description: "**Who can call this:** admin (super_admin always allowed)."
 *     tags: ["Admin - GST, Receivables & Ledger"]
 *     x-roles: [admin]
 *     parameters:
 *       - in: query
 *         name: storeId
 *         schema: { type: string, format: uuid }
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
 *                         accounts:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               account: { type: string }
 *                               debit: { type: number, description: "Amount in INR" }
 *                               credit: { type: number, description: "Amount in INR" }
 *                               balance: { type: number, description: "Amount in INR" }
 *       403:
 *         description: Your role is not allowed to call this.
 */
const getLedgerSummary = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await LedgerService.summary(req.query as Record<string, unknown>);
    return handleSuccessResponse({ statusCode: successCode, result }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /receivables:
 *   get:
 *     operationId: listReceivables
 *     summary: "Who owes what"
 *     description: "**Who can call this:** admin (super_admin always allowed)."
 *     tags: ["Admin - GST, Receivables & Ledger"]
 *     x-roles: [admin]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, description: "1-based page number" }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, description: "page size, max 100" }
 *       - in: query
 *         name: customerId
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: storeId
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [open, overdue, paid] }
 *       - in: query
 *         name: olderThanDays
 *         schema: { type: integer }
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
 *                               customerId: { type: string, format: uuid }
 *                               invoiceId: { type: string, format: uuid }
 *                               amount: { type: number, description: "Amount in INR" }
 *                               dueOn: { type: string, format: date }
 *                               status: { type: string }
 *                               daysOverdue: { type: integer }
 *                         page: { type: integer }
 *                         limit: { type: integer }
 *                         total: { type: integer }
 *       403:
 *         description: Your role is not allowed to call this.
 */
const listReceivables = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await ReceivableService.listReceivables(req.query as Record<string, unknown>, actorOf(req), parsePage(req.query as Record<string, unknown>));
    return handleSuccessResponse({ statusCode: successCode, result }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /receivables/aging:
 *   get:
 *     operationId: getReceivablesAging
 *     summary: "Outstanding balances by age"
 *     description: "**Who can call this:** admin (super_admin always allowed)."
 *     tags: ["Admin - GST, Receivables & Ledger"]
 *     x-roles: [admin]
 *     parameters:
 *       - in: query
 *         name: storeId
 *         schema: { type: string, format: uuid }
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
 *                         buckets:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               label: { type: string }
 *                               amount: { type: number, description: "Amount in INR" }
 *                               count: { type: integer }
 *                         total: { type: number, description: "Amount in INR" }
 *       403:
 *         description: Your role is not allowed to call this.
 */
const getReceivablesAging = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await ReceivableService.getAging(req.query as Record<string, unknown>, actorOf(req));
    return handleSuccessResponse({ statusCode: successCode, result }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /receivables/reminders/run:
 *   post:
 *     operationId: runReceivableReminders
 *     summary: "Send reminders to everyone with an outstanding balance"
 *     description: "**Who can call this:** admin (super_admin always allowed)."
 *     tags: ["Admin - GST, Receivables & Ledger"]
 *     x-roles: [admin]
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               olderThanDays: { type: integer }
 *               channel: { type: string, enum: [sms, email, whatsapp] }
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
 *                         sent: { type: integer }
 *       400:
 *         description: "Missing or invalid fields."
 *       403:
 *         description: Your role is not allowed to call this.
 */
const runReceivableReminders = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await ReceivableService.runReminders(req.body, actorOf(req));
    return handleSuccessResponse({ statusCode: successCode, result }, res, "Reminder run finished.");
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /receivables/{id}:
 *   get:
 *     operationId: getReceivable
 *     summary: "One outstanding balance"
 *     description: "**Who can call this:** admin (super_admin always allowed)."
 *     tags: ["Admin - GST, Receivables & Ledger"]
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
const getReceivable = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await ReceivableService.getReceivable(req.params.id as string, actorOf(req));
    return handleSuccessResponse({ statusCode: successCode, result }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /receivables/{id}/payments:
 *   post:
 *     operationId: recordReceivablePayment
 *     summary: "Record a payment against a balance"
 *     description: "**Who can call this:** admin (super_admin always allowed). A payment larger than the outstanding balance is refused with 409."
 *     tags: ["Admin - GST, Receivables & Ledger"]
 *     x-roles: [admin]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *       - in: header
 *         name: Idempotency-Key
 *         required: false
 *         schema: { type: string, maxLength: 128 }
 *         description: "A retry with the same key returns the first payment instead of recording a second."
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [amount, mode]
 *             properties:
 *               amount: { type: number, description: "Amount in INR" }
 *               mode: { type: string, enum: [cash, bank, upi, card] }
 *               reference: { type: string }
 *     responses:
 *       201:
 *         description: "Created."
 *       400:
 *         description: "Missing or invalid fields."
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 */
const recordReceivablePayment = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await ReceivableService.recordPayment(req.params.id as string, req.body, actorOf(req), req.header("idempotency-key"));
    return handleSuccessResponse({ statusCode: created, result }, res, "Payment recorded.");
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /receivables/{id}/reminder:
 *   post:
 *     operationId: sendReceivableReminder
 *     summary: "Remind one customer"
 *     description: "**Who can call this:** admin (super_admin always allowed)."
 *     tags: ["Admin - GST, Receivables & Ledger"]
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
 *             required: [channel]
 *             properties:
 *               channel: { type: string, enum: [sms, email, whatsapp] }
 *               message: { type: string }
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
const sendReceivableReminder = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await ReceivableService.sendReminder(req.params.id as string, req.body, actorOf(req));
    return handleSuccessResponse({ statusCode: successCode, result }, res, "Reminder processed.");
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

export const AdminGstController = {
  listGstReports,
  generateGstReport,
  getGstReport,
  exportGstReport,
  listLedgerEntries,
  getLedgerSummary,
  listReceivables,
  getReceivablesAging,
  runReceivableReminders,
  getReceivable,
  recordReceivablePayment,
  sendReceivableReminder,
};
