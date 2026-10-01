import { Response } from "express";
import { handleErrorResponse, handleSuccessResponse } from "../../commons/Response/Response.js";
import { created, successCode } from "../../commons/Utils/StatusCode.js";
import { IdentifiedRequest } from "../Middleware/Identity.js";
import { resolveStoreScope } from "../Middleware/StoreScope.js";
import { StoreCashService } from "../Services/StoreCash.Service.js";

/**
 * @openapi
 * /stores/{id}/cash/counts:
 *   post:
 *     operationId: countCash
 *     summary: "Count the day's cash"
 *     description: "**Who can call this:** admin, manager, staff (super_admin always allowed). If the count does not match what the system expected, the difference is raised the same day."
 *     tags: ["Store - Cash & Banking"]
 *     x-roles: [admin, manager, staff]
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
 *             required: [date, countedAmount]
 *             properties:
 *               date: { type: string, format: date }
 *               countedAmount: { type: number, description: "Amount in INR" }
 *               denominations: { type: object, description: "e.g. { 500: 12, 100: 40 }" }
 *               note: { type: string }
 *     responses:
 *       201:
 *         description: "Created."
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
 *                         expected: { type: number, description: "Amount in INR" }
 *                         counted: { type: number, description: "Amount in INR" }
 *                         variance: { type: number, description: "Amount in INR" }
 *       400:
 *         description: "Missing or invalid fields."
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 */
const countCash = async (req: IdentifiedRequest, res: Response) => {
  try {
    const scope = resolveStoreScope(req);
    const user = req.user as NonNullable<typeof req.user>;
    const result = await StoreCashService.countCash(scope, user, req.params.id, req.body);
    return handleSuccessResponse({ statusCode: created, result }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /stores/{id}/cash/counts:
 *   get:
 *     operationId: listCashCounts
 *     summary: "Past cash counts"
 *     description: "**Who can call this:** admin, manager, staff (super_admin always allowed)."
 *     tags: ["Store - Cash & Banking"]
 *     x-roles: [admin, manager, staff]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
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
 *                               date: { type: string, format: date }
 *                               expected: { type: number, description: "Amount in INR" }
 *                               counted: { type: number, description: "Amount in INR" }
 *                               variance: { type: number, description: "Amount in INR" }
 *                         page: { type: integer }
 *                         limit: { type: integer }
 *                         total: { type: integer }
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 */
const listCashCounts = async (req: IdentifiedRequest, res: Response) => {
  try {
    const scope = resolveStoreScope(req);
    const result = await StoreCashService.listCounts(scope, req.params.id, req.query);
    return handleSuccessResponse({ statusCode: successCode, result }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /stores/{id}/cash/deposits:
 *   post:
 *     operationId: recordCashDeposit
 *     summary: "Mark cash as deposited at the bank"
 *     description: "**Who can call this:** admin, manager, staff (super_admin always allowed)."
 *     tags: ["Store - Cash & Banking"]
 *     x-roles: [admin, manager, staff]
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
 *             required: [amount, bankReference]
 *             properties:
 *               amount: { type: number, description: "Amount in INR" }
 *               bankReference: { type: string }
 *               depositedAt: { type: string, format: date-time }
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
const recordCashDeposit = async (req: IdentifiedRequest, res: Response) => {
  try {
    const scope = resolveStoreScope(req);
    const user = req.user as NonNullable<typeof req.user>;
    const result = await StoreCashService.recordCashDeposit(scope, user, req.params.id, req.body);
    return handleSuccessResponse({ statusCode: created, result }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /stores/{id}/cash/deposits:
 *   get:
 *     operationId: listCashDeposits
 *     summary: "Bank deposits"
 *     description: "**Who can call this:** admin, manager, staff (super_admin always allowed)."
 *     tags: ["Store - Cash & Banking"]
 *     x-roles: [admin, manager, staff]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
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
 *                               amount: { type: number, description: "Amount in INR" }
 *                               bankReference: { type: string }
 *                               depositedAt: { type: string, format: date-time }
 *                         page: { type: integer }
 *                         limit: { type: integer }
 *                         total: { type: integer }
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 */
const listCashDeposits = async (req: IdentifiedRequest, res: Response) => {
  try {
    const scope = resolveStoreScope(req);
    const result = await StoreCashService.listCashDeposits(scope, req.params.id, req.query);
    return handleSuccessResponse({ statusCode: successCode, result }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /stores/{id}/cash/variances:
 *   get:
 *     operationId: listStoreCashVariances
 *     summary: "Unresolved cash differences at this store"
 *     description: "**Who can call this:** admin, manager, staff (super_admin always allowed)."
 *     tags: ["Store - Cash & Banking"]
 *     x-roles: [admin, manager, staff]
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
 *                         variances:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               id: { type: string, format: uuid }
 *                               date: { type: string, format: date }
 *                               amount: { type: number, description: "Amount in INR" }
 *                               status: { type: string, enum: [open, explained, resolved] }
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 */
const listStoreCashVariances = async (req: IdentifiedRequest, res: Response) => {
  try {
    const scope = resolveStoreScope(req);
    const result = await StoreCashService.listStoreCashVariances(scope, req.params.id, req.query);
    return handleSuccessResponse({ statusCode: successCode, result }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /stores/{id}/day/close:
 *   post:
 *     operationId: closeStoreDay
 *     summary: "Close the day at this store"
 *     description: "**Who can call this:** admin, manager (super_admin always allowed)."
 *     tags: ["Store - Cash & Banking"]
 *     x-roles: [admin, manager]
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
 *             required: [date]
 *             properties:
 *               date: { type: string, format: date }
 *               notes: { type: string }
 *     responses:
 *       200:
 *         description: "OK."
 *       400:
 *         description: "Missing or invalid fields."
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 *       409:
 *         description: "The cash count or deposit for the day is still missing."
 */
const closeStoreDay = async (req: IdentifiedRequest, res: Response) => {
  try {
    const scope = resolveStoreScope(req);
    const user = req.user as NonNullable<typeof req.user>;
    const result = await StoreCashService.closeStoreDay(scope, user, req.params.id, req.body);
    return handleSuccessResponse({ statusCode: successCode, result }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /stores/{id}/day/status:
 *   get:
 *     operationId: getStoreDayStatus
 *     summary: "Is today counted, banked and closed?"
 *     description: "**Who can call this:** admin, manager, staff (super_admin always allowed)."
 *     tags: ["Store - Cash & Banking"]
 *     x-roles: [admin, manager, staff]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: date
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
 *                         date: { type: string, format: date }
 *                         counted: { type: boolean }
 *                         banked: { type: boolean }
 *                         closed: { type: boolean }
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 */
const getStoreDayStatus = async (req: IdentifiedRequest, res: Response) => {
  try {
    const scope = resolveStoreScope(req);
    const result = await StoreCashService.getStoreDayStatus(scope, req.params.id, req.query);
    return handleSuccessResponse({ statusCode: successCode, result }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

export const StoreCashController = {
  countCash,
  listCashCounts,
  recordCashDeposit,
  listCashDeposits,
  listStoreCashVariances,
  closeStoreDay,
  getStoreDayStatus,
};
