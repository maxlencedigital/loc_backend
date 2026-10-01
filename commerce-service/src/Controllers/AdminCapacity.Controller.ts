import { Response } from "express";
import { handleErrorResponse, handleSuccessResponse } from "../../commons/Response/Response.js";
import { successCode } from "../../commons/Utils/StatusCode.js";
import { IdentifiedRequest, RequestUser } from "../Middleware/Identity.js";
import { resolveStoreScope } from "../Middleware/StoreScope.js";
import { CapacityService } from "../Services/Capacity.Service.js";

/**
 * @openapi
 * /operations/capacity/forecast:
 *   get:
 *     operationId: getCapacityForecast
 *     summary: "Are tomorrow and the days after filling up?"
 *     description: "**Who can call this:** admin, hr, manager (super_admin always allowed)."
 *     tags: ["Admin - Capacity & Forecast"]
 *     x-roles: [admin, hr, manager]
 *     parameters:
 *       - in: query
 *         name: storeId
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: days
 *         schema: { type: integer, description: "how many days ahead, default 7" }
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
 *                         days:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               date: { type: string, format: date }
 *                               expectedOrders: { type: integer }
 *                               capacity: { type: integer }
 *                               utilisationPct: { type: number }
 *                               bottleneck: { type: string }
 *                               risk: { type: string, enum: [low, medium, high] }
 *       403:
 *         description: Your role is not allowed to call this.
 */
const getCapacityForecast = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await CapacityService.getCapacityForecast(resolveStoreScope(req), req.query);
    return handleSuccessResponse({ statusCode: successCode, result }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /operations/capacity/now:
 *   get:
 *     operationId: getCapacityNow
 *     summary: "What the business can actually take on right now"
 *     description: "**Who can call this:** admin, hr, manager (super_admin always allowed). Capacity is three things lining up: a free machine, staff on shift, and an available rider. Whichever runs out first is the real limit."
 *     tags: ["Admin - Capacity & Forecast"]
 *     x-roles: [admin, hr, manager]
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
 *                         asOf: { type: string, format: date-time }
 *                         machines:
 *                           type: object
 *                           properties:
 *                             total: { type: integer }
 *                             busy: { type: integer }
 *                             free: { type: integer }
 *                         staff:
 *                           type: object
 *                           properties:
 *                             onShift: { type: integer }
 *                             required: { type: integer }
 *                         riders:
 *                           type: object
 *                           properties:
 *                             available: { type: integer }
 *                             total: { type: integer }
 *                         bottleneck: { type: string, enum: [machines, staff, riders, none] }
 *                         expressCanAccept: { type: boolean }
 *       403:
 *         description: Your role is not allowed to call this.
 */
const getCapacityNow = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await CapacityService.getCapacityNow(resolveStoreScope(req), req.query);
    return handleSuccessResponse({ statusCode: successCode, result }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /operations/express/at-risk:
 *   get:
 *     operationId: listExpressAtRisk
 *     summary: "Express orders drifting behind their promise"
 *     description: "**Who can call this:** admin, hr, manager (super_admin always allowed). Flagged before the customer has to ask where it is."
 *     tags: ["Admin - Capacity & Forecast"]
 *     x-roles: [admin, hr, manager]
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
 *                         orders:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               orderId: { type: string, format: uuid }
 *                               orderNumber: { type: string }
 *                               promisedAt: { type: string, format: date-time }
 *                               projectedAt: { type: string, format: date-time }
 *                               delayMinutes: { type: integer }
 *                               stage: { type: string }
 *       403:
 *         description: Your role is not allowed to call this.
 */
const listExpressAtRisk = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await CapacityService.listExpressAtRisk(resolveStoreScope(req), req.query);
    return handleSuccessResponse({ statusCode: successCode, result }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

export const AdminCapacityController = {
  getCapacityForecast,
  getCapacityNow,
  listExpressAtRisk,
};
