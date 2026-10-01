import { Response } from "express";
import { IdentifiedRequest } from "../Middleware/Identity.js";
import { actorOf } from "../Middleware/StoreScope.js";
import { handleErrorResponse, handleSuccessResponse } from "../../commons/Response/Response.js";
import { parsePage } from "../../commons/Utils/Pagination.js";
import { created, successCode } from "../../commons/Utils/StatusCode.js";
import { AnalyticsService } from "../Services/Analytics.Service.js";

/**
 * @openapi
 * /analytics/order-cost:
 *   get:
 *     operationId: getOrderCost
 *     summary: "What an order really costs: water, electricity, detergent, labour"
 *     description: "**Who can call this:** admin (super_admin always allowed)."
 *     tags: ["Admin - Cost & Resource Analytics"]
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
 *                         averagePerOrder:
 *                           type: object
 *                           properties:
 *                             water: { type: number, description: "Amount in INR" }
 *                             electricity: { type: number, description: "Amount in INR" }
 *                             detergent: { type: number, description: "Amount in INR" }
 *                             labour: { type: number, description: "Amount in INR" }
 *                             total: { type: number, description: "Amount in INR" }
 *                         series:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               date: { type: string, format: date }
 *                               perOrder: { type: number, description: "Amount in INR" }
 *       403:
 *         description: Your role is not allowed to call this.
 */
const getOrderCost = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await AnalyticsService.orderCost(req.query as Record<string, unknown>, actorOf(req));
    return handleSuccessResponse({ statusCode: successCode, result }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /analytics/resource-usage:
 *   get:
 *     operationId: getResourceUsage
 *     summary: "Water, electricity and detergent used"
 *     description: "**Who can call this:** admin (super_admin always allowed)."
 *     tags: ["Admin - Cost & Resource Analytics"]
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
 *       - in: query
 *         name: resource
 *         schema: { type: string, enum: [water, electricity, detergent] }
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
 *                         total: { type: number }
 *                         perOrder: { type: number }
 *                         series:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               date: { type: string, format: date }
 *                               value: { type: number }
 *       403:
 *         description: Your role is not allowed to call this.
 */
const getResourceUsage = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await AnalyticsService.resourceUsage(req.query as Record<string, unknown>, actorOf(req));
    return handleSuccessResponse({ statusCode: successCode, result }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /analytics/store-economics:
 *   get:
 *     operationId: getStoreEconomics
 *     summary: "The real cost of running each store"
 *     description: "**Who can call this:** admin (super_admin always allowed). Matters a great deal once the business opens more locations."
 *     tags: ["Admin - Cost & Resource Analytics"]
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
 *                         stores:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               storeId: { type: string, format: uuid }
 *                               name: { type: string }
 *                               revenue: { type: number, description: "Amount in INR" }
 *                               runningCost: { type: number, description: "Amount in INR" }
 *                               margin: { type: number, description: "Amount in INR" }
 *                               marginPct: { type: number }
 *       403:
 *         description: Your role is not allowed to call this.
 */
const getStoreEconomics = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await AnalyticsService.storeEconomics(req.query as Record<string, unknown>, actorOf(req));
    return handleSuccessResponse({ statusCode: successCode, result }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

export const AdminAnalyticsController = {
  getOrderCost,
  getResourceUsage,
  getStoreEconomics,
};
