import { Response } from "express";
import { IdentifiedRequest } from "../Middleware/Identity.js";
import { requestActor } from "../Middleware/StoreScope.js";
import { handleErrorResponse, handleSuccessResponse } from "../../commons/Response/Response.js";
import { successCode } from "../../commons/Utils/StatusCode.js";
import { RiderEarningsService } from "../Services/RiderEarnings.Service.js";

/**
 * @openapi
 * /rider/cash-balance:
 *   get:
 *     operationId: getRiderCashBalance
 *     summary: "Cash I have collected and not yet handed over"
 *     description: "**Who can call this:** driver (super_admin always allowed)."
 *     tags: ["Rider - Earnings & Summary"]
 *     x-roles: [driver]
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
 *                         collected: { type: number, description: "Amount in INR" }
 *                         settled: { type: number, description: "Amount in INR" }
 *                         outstanding: { type: number, description: "Amount in INR" }
 *       403:
 *         description: Your role is not allowed to call this.
 */
const getRiderCashBalance = async (req: IdentifiedRequest, res: Response) => {
  try {
    const actor = requestActor(req);
    return handleSuccessResponse(
      { statusCode: successCode, result: await RiderEarningsService.cashBalance(actor) },
      res
    );
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /rider/earnings:
 *   get:
 *     operationId: getRiderEarnings
 *     summary: "What I earned and what it was made of"
 *     description: "**Who can call this:** driver (super_admin always allowed)."
 *     tags: ["Rider - Earnings & Summary"]
 *     x-roles: [driver]
 *     parameters:
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
 *                         jobsCompleted: { type: integer }
 *                         distanceKm: { type: number }
 *                         base: { type: number, description: "Amount in INR" }
 *                         incentives: { type: number, description: "Amount in INR" }
 *                         total: { type: number, description: "Amount in INR" }
 *                         paid: { type: number, description: "Amount in INR" }
 *                         due: { type: number, description: "Amount in INR" }
 *       403:
 *         description: Your role is not allowed to call this.
 */
const getRiderEarnings = async (req: IdentifiedRequest, res: Response) => {
  try {
    const actor = requestActor(req);
    return handleSuccessResponse(
      { statusCode: successCode, result: await RiderEarningsService.earnings(actor, req.query) },
      res
    );
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /rider/ratings:
 *   get:
 *     operationId: getRiderRatings
 *     summary: "How customers rated me"
 *     description: "**Who can call this:** driver (super_admin always allowed)."
 *     tags: ["Rider - Earnings & Summary"]
 *     x-roles: [driver]
 *     parameters:
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
 *                         average: { type: number }
 *                         count: { type: integer }
 *                         recent:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               rating: { type: integer }
 *                               comment: { type: string }
 *                               at: { type: string, format: date-time }
 *       403:
 *         description: Your role is not allowed to call this.
 */
const getRiderRatings = async (req: IdentifiedRequest, res: Response) => {
  try {
    const actor = requestActor(req);
    return handleSuccessResponse(
      { statusCode: successCode, result: await RiderEarningsService.ratings(actor, req.query) },
      res
    );
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

export const RiderEarningsController = {
  getRiderCashBalance,
  getRiderEarnings,
  getRiderRatings,
};
