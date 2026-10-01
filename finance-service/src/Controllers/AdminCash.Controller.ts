import { Response } from "express";
import { IdentifiedRequest } from "../Middleware/Identity.js";
import { actorOf } from "../Middleware/StoreScope.js";
import { handleErrorResponse, handleSuccessResponse } from "../../commons/Response/Response.js";
import { parsePage } from "../../commons/Utils/Pagination.js";
import { created, successCode } from "../../commons/Utils/StatusCode.js";
import { CashService } from "../Services/Cash.Service.js";

/**
 * @openapi
 * /cash/daily:
 *   get:
 *     operationId: getDailyCash
 *     summary: "What was collected, what was banked, and whether the two agree"
 *     description: "**Who can call this:** admin, manager (super_admin always allowed). Any difference is visible the same day, not discovered at month end."
 *     tags: ["Admin - Cash & Daily Close"]
 *     x-roles: [admin, manager]
 *     parameters:
 *       - in: query
 *         name: date
 *         required: true
 *         schema: { type: string, format: date }
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
 *                         stores:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               storeId: { type: string, format: uuid }
 *                               name: { type: string }
 *                               expected: { type: number, description: "Amount in INR" }
 *                               counted: { type: number, description: "Amount in INR" }
 *                               banked: { type: number, description: "Amount in INR" }
 *                               variance: { type: number, description: "Amount in INR" }
 *                               status: { type: string, enum: [agreed, variance, missing] }
 *                         total:
 *                           type: object
 *                           properties:
 *                             expected: { type: number, description: "Amount in INR" }
 *                             counted: { type: number, description: "Amount in INR" }
 *                             banked: { type: number, description: "Amount in INR" }
 *                             variance: { type: number, description: "Amount in INR" }
 *       403:
 *         description: Your role is not allowed to call this.
 */
const getDailyCash = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await CashService.getDailyCash(req.query as Record<string, unknown>, actorOf(req));
    return handleSuccessResponse({ statusCode: successCode, result }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /cash/variances:
 *   get:
 *     operationId: listCashVariances
 *     summary: "Cash differences across stores"
 *     description: "**Who can call this:** admin, manager (super_admin always allowed)."
 *     tags: ["Admin - Cash & Daily Close"]
 *     x-roles: [admin, manager]
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
 *         name: resolved
 *         schema: { type: boolean }
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
 *                               storeId: { type: string, format: uuid }
 *                               date: { type: string, format: date }
 *                               amount: { type: number, description: "Amount in INR" }
 *                               status: { type: string }
 *                         page: { type: integer }
 *                         limit: { type: integer }
 *                         total: { type: integer }
 *       403:
 *         description: Your role is not allowed to call this.
 */
const listCashVariances = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await CashService.listCashVariances(req.query as Record<string, unknown>, actorOf(req), parsePage(req.query as Record<string, unknown>));
    return handleSuccessResponse({ statusCode: successCode, result }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /cash/variances/{id}/resolve:
 *   post:
 *     operationId: resolveCashVariance
 *     summary: "Explain and close a cash difference"
 *     description: "**Who can call this:** admin (super_admin always allowed)."
 *     tags: ["Admin - Cash & Daily Close"]
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
 *             required: [resolution]
 *             properties:
 *               resolution: { type: string }
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
const resolveCashVariance = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await CashService.resolveCashVariance(req.params.id as string, req.body, actorOf(req));
    return handleSuccessResponse({ statusCode: successCode, result }, res, "Cash variance resolved.");
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /daily-close:
 *   get:
 *     operationId: listDailyCloses
 *     summary: "Closed days"
 *     description: "**Who can call this:** admin, manager (super_admin always allowed)."
 *     tags: ["Admin - Cash & Daily Close"]
 *     x-roles: [admin, manager]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, description: "1-based page number" }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, description: "page size, max 100" }
 *       - in: query
 *         name: date
 *         schema: { type: string, format: date }
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
 *                         items:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               id: { type: string, format: uuid }
 *                               storeId: { type: string, format: uuid }
 *                               date: { type: string, format: date }
 *                               closedBy: { type: string }
 *                               status: { type: string, enum: [closed, approved] }
 *                         page: { type: integer }
 *                         limit: { type: integer }
 *                         total: { type: integer }
 *       403:
 *         description: Your role is not allowed to call this.
 */
const listDailyCloses = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await CashService.listDailyCloses(req.query as Record<string, unknown>, actorOf(req), parsePage(req.query as Record<string, unknown>));
    return handleSuccessResponse({ statusCode: successCode, result }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /daily-close/{id}:
 *   get:
 *     operationId: getDailyClose
 *     summary: "One daily close"
 *     description: "**Who can call this:** admin, manager (super_admin always allowed)."
 *     tags: ["Admin - Cash & Daily Close"]
 *     x-roles: [admin, manager]
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
const getDailyClose = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await CashService.getDailyClose(req.params.id as string, actorOf(req));
    return handleSuccessResponse({ statusCode: successCode, result }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /daily-close/{id}/approve:
 *   post:
 *     operationId: approveDailyClose
 *     summary: "Approve a store's day"
 *     description: "**Who can call this:** admin (super_admin always allowed)."
 *     tags: ["Admin - Cash & Daily Close"]
 *     x-roles: [admin]
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
const approveDailyClose = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await CashService.approveDailyClose(req.params.id as string, req.body, actorOf(req));
    return handleSuccessResponse({ statusCode: successCode, result }, res, "Daily close approved.");
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

export const AdminCashController = {
  getDailyCash,
  listCashVariances,
  resolveCashVariance,
  listDailyCloses,
  getDailyClose,
  approveDailyClose,
};
