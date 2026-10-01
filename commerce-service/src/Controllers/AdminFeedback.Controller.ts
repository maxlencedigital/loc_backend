import { Response } from "express";
import { handleErrorResponse, handleSuccessResponse } from "../../commons/Response/Response.js";
import { successCode } from "../../commons/Utils/StatusCode.js";
import { IdentifiedRequest, RequestUser } from "../Middleware/Identity.js";
import { resolveStoreScope } from "../Middleware/StoreScope.js";
import { EscalationService } from "../Services/Escalation.Service.js";
import { FeedbackService } from "../Services/Feedback.Service.js";

const id = (req: IdentifiedRequest) => req.params.id as string;

/**
 * @openapi
 * /escalations:
 *   get:
 *     operationId: listEscalations
 *     summary: "Complaints a store could not settle"
 *     description: "**Who can call this:** admin (super_admin always allowed). With no status filter, the escalations still waiting for a decision; ask for resolved to see decided ones. Most recently escalated first."
 *     tags: ["Admin - Escalations & Feedback"]
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
 *         schema: { type: string, enum: [open, assigned, in_progress, resolved, escalated, closed], default: escalated }
 *       - in: query
 *         name: storeId
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: type
 *         schema: { type: string, enum: [damaged_item, late_delivery, wrong_charge, missing_item, quality, rider_behaviour, other] }
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
 *                               storeId: { type: string, format: uuid }
 *                               type: { type: string, enum: [damaged_item, late_delivery, wrong_charge, missing_item, quality, rider_behaviour, other] }
 *                               status: { type: string }
 *                               reason: { type: string }
 *                               escalatedAt: { type: string, format: date-time }
 *                         page: { type: integer }
 *                         limit: { type: integer }
 *                         total: { type: integer }
 *       400:
 *         description: "Invalid filter."
 *       403:
 *         description: Your role is not allowed to call this.
 */
const listEscalations = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse(
      { statusCode: successCode, result: await EscalationService.list(resolveStoreScope(req), req.query) },
      res
    );
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /escalations/{id}:
 *   get:
 *     operationId: getEscalation
 *     summary: "An escalated complaint with everything tried so far"
 *     description: "**Who can call this:** admin (super_admin always allowed). The full complaint including the whole thread and internal notes. A complaint that was never escalated is a 404."
 *     tags: ["Admin - Escalations & Feedback"]
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
const getEscalation = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse(
      { statusCode: successCode, result: await EscalationService.get(resolveStoreScope(req), id(req)) },
      res
    );
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /escalations/{id}/decision:
 *   post:
 *     operationId: decideEscalation
 *     summary: "The final decision: refund, goodwill or a policy call"
 *     description: "**Who can call this:** admin (super_admin always allowed). Only for an escalated complaint (409 otherwise); it becomes resolved. A refund needs an amount; goodwill may have one; the other decisions take none. The amount may not exceed the order amount. The decision is recorded, not paid out by this service."
 *     tags: ["Admin - Escalations & Feedback"]
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
 *             required: [decision, note]
 *             properties:
 *               decision: { type: string, enum: [refund, goodwill, reject, policy_exception] }
 *               amount: { type: number, description: "Amount in INR" }
 *               note: { type: string, maxLength: 2000 }
 *     responses:
 *       200:
 *         description: "The complaint with its history."
 *       400:
 *         description: "Missing or invalid fields."
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 *       409:
 *         description: "The complaint is not waiting for a decision."
 */
const decideEscalation = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await EscalationService.decide(req.user as RequestUser, resolveStoreScope(req), id(req), req.body);
    return handleSuccessResponse({ statusCode: successCode, result }, res, "Decision recorded.");
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /feedback:
 *   get:
 *     operationId: listFeedback
 *     summary: "Customer feedback, good and bad"
 *     description: "**Who can call this:** admin, hr, manager (super_admin always allowed). A manager sees their own store only; asking for another store is a 404. Newest first."
 *     tags: ["Admin - Escalations & Feedback"]
 *     x-roles: [admin, hr, manager]
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
 *         name: riderId
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: rating
 *         schema: { type: integer, minimum: 1, maximum: 5 }
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
 *                               rating: { type: integer }
 *                               comment: { type: string, nullable: true }
 *                               storeRating: { type: integer, nullable: true }
 *                               riderRating: { type: integer, nullable: true }
 *                               storeId: { type: string, format: uuid }
 *                               riderId: { type: string, format: uuid, nullable: true }
 *                               createdAt: { type: string, format: date-time }
 *                         page: { type: integer }
 *                         limit: { type: integer }
 *                         total: { type: integer }
 *       400:
 *         description: "Invalid filter."
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: "Store not found."
 */
const listFeedback = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse(
      { statusCode: successCode, result: await FeedbackService.list(resolveStoreScope(req), req.query) },
      res
    );
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /feedback/summary:
 *   get:
 *     operationId: getFeedbackSummary
 *     summary: "How customers are feeling, by store and by rider"
 *     description: "**Who can call this:** admin, hr, manager (super_admin always allowed). Praise is captured too, so the business knows which stores and riders are doing well. Everything is a database aggregate. average, distribution and byStore use the overall rating; byRider uses the rider rating (top 100 by count); trend is one row per day for the last 90 days of the chosen range. An explicit range is at most 366 days."
 *     tags: ["Admin - Escalations & Feedback"]
 *     x-roles: [admin, hr, manager]
 *     parameters:
 *       - in: query
 *         name: storeId
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: riderId
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
 *                         average: { type: number, nullable: true }
 *                         count: { type: integer }
 *                         distribution: { type: object, description: "{ 1: n, 2: n, 3: n, 4: n, 5: n }" }
 *                         byStore:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               storeId: { type: string, format: uuid }
 *                               average: { type: number }
 *                               count: { type: integer }
 *                         byRider:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               riderId: { type: string, format: uuid }
 *                               average: { type: number }
 *                               count: { type: integer }
 *                         trend:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               date: { type: string, format: date }
 *                               average: { type: number }
 *                               count: { type: integer }
 *       400:
 *         description: "Invalid filter or a range over 366 days."
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: "Store not found."
 */
const getFeedbackSummary = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse(
      { statusCode: successCode, result: await FeedbackService.summary(resolveStoreScope(req), req.query) },
      res
    );
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

export const AdminFeedbackController = {
  listEscalations,
  getEscalation,
  decideEscalation,
  listFeedback,
  getFeedbackSummary,
};
