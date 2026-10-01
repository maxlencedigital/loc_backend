import { Response } from "express";
import { handleErrorResponse, handleSuccessResponse } from "../../commons/Response/Response.js";
import { created, successCode } from "../../commons/Utils/StatusCode.js";
import { IdentifiedRequest } from "../Middleware/Identity.js";
import { LoyaltyService } from "../Services/Loyalty.Service.js";
import { RetentionService } from "../Services/Retention.Service.js";
import { actorId } from "./Actor.js";

/**
 * @openapi
 * /loyalty/accounts/{customerId}:
 *   get:
 *     operationId: getLoyaltyAccount
 *     summary: "A customer's points"
 *     description: "**Who can call this:** admin (super_admin always allowed)."
 *     tags: ["Admin - Loyalty & Retention"]
 *     x-roles: [admin]
 *     parameters:
 *       - in: path
 *         name: customerId
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
 *                         customerId: { type: string, format: uuid }
 *                         points: { type: integer }
 *                         tier: { type: string }
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 */
const getLoyaltyAccount = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await LoyaltyService.getAccount(req.params.customerId);
    return handleSuccessResponse({ statusCode: successCode, result }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /loyalty/accounts/{customerId}/adjustments:
 *   post:
 *     operationId: adjustLoyaltyPoints
 *     summary: "Correct a customer's points"
 *     description: "**Who can call this:** admin (super_admin always allowed)."
 *     tags: ["Admin - Loyalty & Retention"]
 *     x-roles: [admin]
 *     parameters:
 *       - in: path
 *         name: customerId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [points, reason]
 *             properties:
 *               points: { type: integer, description: "negative to remove" }
 *               reason: { type: string }
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
const adjustLoyaltyPoints = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await LoyaltyService.adjust(req.params.customerId, actorId(req), req.body);
    return handleSuccessResponse({ statusCode: created, result }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /loyalty/program:
 *   get:
 *     operationId: getLoyaltyProgram
 *     summary: "How the loyalty programme works"
 *     description: "**Who can call this:** admin (super_admin always allowed)."
 *     tags: ["Admin - Loyalty & Retention"]
 *     x-roles: [admin]
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
 *                         pointsPerRupee: { type: number }
 *                         redemptionValue: { type: number, description: "Amount in INR" }
 *                         expiryDays: { type: integer }
 *                         tiers:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               name: { type: string }
 *                               minPoints: { type: integer }
 *                               benefits: { type: array, items: { type: string } }
 *       403:
 *         description: Your role is not allowed to call this.
 */
const getLoyaltyProgram = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await LoyaltyService.getProgram();
    return handleSuccessResponse({ statusCode: successCode, result }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /loyalty/program:
 *   put:
 *     operationId: setLoyaltyProgram
 *     summary: "Set the loyalty programme"
 *     description: "**Who can call this:** admin (super_admin always allowed)."
 *     tags: ["Admin - Loyalty & Retention"]
 *     x-roles: [admin]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [pointsPerRupee, redemptionValue, tiers]
 *             properties:
 *               pointsPerRupee: { type: number }
 *               redemptionValue: { type: number, description: "Amount in INR" }
 *               expiryDays: { type: integer }
 *               tiers:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required: [name, minPoints]
 *                   properties:
 *                     name: { type: string }
 *                     minPoints: { type: integer }
 *                     benefits: { type: array, items: { type: string } }
 *     responses:
 *       200:
 *         description: "OK."
 *       400:
 *         description: "Missing or invalid fields."
 *       403:
 *         description: Your role is not allowed to call this.
 */
const setLoyaltyProgram = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await LoyaltyService.setProgram(req.body);
    return handleSuccessResponse({ statusCode: successCode, result }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /loyalty/transactions:
 *   get:
 *     operationId: listLoyaltyTransactions
 *     summary: "Loyalty activity"
 *     description: "**Who can call this:** admin (super_admin always allowed)."
 *     tags: ["Admin - Loyalty & Retention"]
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
 *                               customerId: { type: string, format: uuid }
 *                               points: { type: integer }
 *                               reason: { type: string }
 *                               at: { type: string, format: date-time }
 *                         page: { type: integer }
 *                         limit: { type: integer }
 *                         total: { type: integer }
 *       403:
 *         description: Your role is not allowed to call this.
 */
const listLoyaltyTransactions = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await LoyaltyService.listTransactions(req.query);
    return handleSuccessResponse({ statusCode: successCode, result }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /retention/at-risk:
 *   get:
 *     operationId: listAtRiskCustomers
 *     summary: "Customers who look like they are drifting away"
 *     description: "**Who can call this:** admin (super_admin always allowed). So the business can reach out before losing them."
 *     tags: ["Admin - Loyalty & Retention"]
 *     x-roles: [admin]
 *     parameters:
 *       - in: query
 *         name: storeId
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: minScore
 *         schema: { type: number }
 *       - in: query
 *         name: limit
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
 *                         customers:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               customerId: { type: string, format: uuid }
 *                               name: { type: string }
 *                               score: { type: number }
 *                               lastOrderAt: { type: string, format: date-time }
 *                               reasons: { type: array, items: { type: string } }
 *       403:
 *         description: Your role is not allowed to call this.
 */
const listAtRiskCustomers = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await RetentionService.listAtRisk(req.query);
    return handleSuccessResponse({ statusCode: successCode, result }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /retention/customers/{customerId}:
 *   get:
 *     operationId: getCustomerRetention
 *     summary: "Why one customer looks at risk"
 *     description: "**Who can call this:** admin (super_admin always allowed)."
 *     tags: ["Admin - Loyalty & Retention"]
 *     x-roles: [admin]
 *     parameters:
 *       - in: path
 *         name: customerId
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
 *                         score: { type: number }
 *                         reasons: { type: array, items: { type: string } }
 *                         orderHistory:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               date: { type: string, format: date }
 *                               total: { type: number, description: "Amount in INR" }
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 */
const getCustomerRetention = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await RetentionService.getCustomer(req.params.customerId);
    return handleSuccessResponse({ statusCode: successCode, result }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /retention/customers/{customerId}/win-back:
 *   post:
 *     operationId: sendWinBack
 *     summary: "Reach out to a customer who is drifting"
 *     description: "**Who can call this:** admin (super_admin always allowed)."
 *     tags: ["Admin - Loyalty & Retention"]
 *     x-roles: [admin]
 *     parameters:
 *       - in: path
 *         name: customerId
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
 *               offerCouponId: { type: string, format: uuid }
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
const sendWinBack = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await RetentionService.sendWinBack(req.params.customerId, req.body);
    return handleSuccessResponse({ statusCode: successCode, result }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /retention/summary:
 *   get:
 *     operationId: getRetentionSummary
 *     summary: "Retention at a glance"
 *     description: "**Who can call this:** admin (super_admin always allowed)."
 *     tags: ["Admin - Loyalty & Retention"]
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
 *                         atRisk: { type: integer }
 *                         winBackRatePct: { type: number }
 *                         repeatRatePct: { type: number }
 *       403:
 *         description: Your role is not allowed to call this.
 */
const getRetentionSummary = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await RetentionService.getSummary(req.query);
    return handleSuccessResponse({ statusCode: successCode, result }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

export const AdminLoyaltyController = {
  getLoyaltyAccount,
  adjustLoyaltyPoints,
  getLoyaltyProgram,
  setLoyaltyProgram,
  listLoyaltyTransactions,
  listAtRiskCustomers,
  getCustomerRetention,
  sendWinBack,
  getRetentionSummary,
};
