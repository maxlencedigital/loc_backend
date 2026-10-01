import { Response } from "express";
import { handleErrorResponse, handleSuccessResponse } from "../../commons/Response/Response.js";
import { created, successCode } from "../../commons/Utils/StatusCode.js";
import { IdentifiedRequest, RequestUser } from "../Middleware/Identity.js";
import { resolveStoreScope } from "../Middleware/StoreScope.js";
import { ComplaintService } from "../Services/Complaint.Service.js";

const who = (req: IdentifiedRequest) => req.user as RequestUser;
const id = (req: IdentifiedRequest) => req.params.id as string;

/**
 * @openapi
 * /complaints:
 *   post:
 *     operationId: logComplaint
 *     summary: "Record a customer complaint properly, not as a verbal promise"
 *     description: "**Who can call this:** admin, manager, staff (super_admin always allowed). The order must be in the caller's store (otherwise 404). Send an Idempotency-Key header to make a retry safe. A live complaint of the same type on the same order is returned (200) instead of a second one."
 *     tags: ["Store - Complaints"]
 *     x-roles: [admin, manager, staff]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [orderId, type, description]
 *             properties:
 *               orderId: { type: string, format: uuid }
 *               type: { type: string, enum: [damaged_item, late_delivery, wrong_charge, missing_item, quality, rider_behaviour, other] }
 *               description: { type: string, maxLength: 2000 }
 *               severity: { type: string, enum: [low, medium, high], default: medium }
 *               itemId: { type: string, format: uuid }
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
 *                         id: { type: string, format: uuid }
 *                         orderId: { type: string, format: uuid }
 *                         status: { type: string, enum: [open, assigned, in_progress, resolved, escalated, closed] }
 *       200:
 *         description: "A retry or an already live complaint; nothing new was created."
 *       400:
 *         description: "Missing or invalid fields."
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: "Order not found in your store."
 */
const logComplaint = async (req: IdentifiedRequest, res: Response) => {
  try {
    const outcome = await ComplaintService.log(who(req), resolveStoreScope(req), req.body, req.header("idempotency-key"));
    return handleSuccessResponse(
      { statusCode: outcome.created ? created : successCode, result: outcome.data },
      res,
      outcome.created ? "Complaint logged." : "This complaint is already logged."
    );
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /complaints:
 *   get:
 *     operationId: listComplaints
 *     summary: "The complaint queue"
 *     description: "**Who can call this:** admin, manager, staff (super_admin always allowed). A manager or staff member sees their own store's complaints; asking for another store's is a 404. Newest first."
 *     tags: ["Store - Complaints"]
 *     x-roles: [admin, manager, staff]
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
 *         schema: { type: string, enum: [open, assigned, in_progress, resolved, escalated, closed] }
 *       - in: query
 *         name: type
 *         schema: { type: string, enum: [damaged_item, late_delivery, wrong_charge, missing_item, quality, rider_behaviour, other] }
 *       - in: query
 *         name: assigneeId
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
 *                               orderId: { type: string, format: uuid }
 *                               orderRef: { type: string }
 *                               storeId: { type: string, format: uuid }
 *                               type: { type: string, enum: [damaged_item, late_delivery, wrong_charge, missing_item, quality, rider_behaviour, other] }
 *                               severity: { type: string, enum: [low, medium, high] }
 *                               status: { type: string, enum: [open, assigned, in_progress, resolved, escalated, closed] }
 *                               assigneeId: { type: string, format: uuid, nullable: true }
 *                               assigneeName: { type: string, nullable: true }
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
const listComplaints = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse(
      { statusCode: successCode, result: await ComplaintService.list(resolveStoreScope(req), req.query) },
      res
    );
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /complaints/{id}:
 *   get:
 *     operationId: getComplaint
 *     summary: "One complaint, with its full history"
 *     description: "**Who can call this:** admin, manager, staff (super_admin always allowed). Includes the whole thread (internal notes too), photos, the resolution and the SLA timestamps (assignedAt, firstResponseAt, resolvedAt, closedAt). A complaint of another store is a 404."
 *     tags: ["Store - Complaints"]
 *     x-roles: [admin, manager, staff]
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
const getComplaint = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await ComplaintService.get(resolveStoreScope(req), id(req)) }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /complaints/{id}/assign:
 *   post:
 *     operationId: assignComplaint
 *     summary: "Assign a complaint to someone"
 *     description: "**Who can call this:** admin, manager, staff (super_admin always allowed). Staff may only assign to themselves. The assignee must be an active staff member or manager of the complaint's store (or an admin). An open complaint becomes assigned. An escalated, resolved or closed complaint cannot be assigned (409)."
 *     tags: ["Store - Complaints"]
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
 *             required: [assigneeId]
 *             properties:
 *               assigneeId: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: "The complaint with its history."
 *       400:
 *         description: "Missing or invalid fields, or the assignee is not eligible."
 *       403:
 *         description: "Your role is not allowed to call this, or staff assigning to someone else."
 *       404:
 *         description: Not found.
 *       409:
 *         description: "The complaint is in a state that cannot be assigned."
 */
const assignComplaint = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await ComplaintService.assign(who(req), resolveStoreScope(req), id(req), req.body);
    return handleSuccessResponse({ statusCode: successCode, result }, res, "Complaint assigned.");
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /complaints/{id}/comments:
 *   post:
 *     operationId: commentOnComplaint
 *     summary: "Add a comment to a complaint"
 *     description: "**Who can call this:** admin, manager, staff (super_admin always allowed). A public comment is shown to the customer, moves an open or assigned complaint to in_progress and stamps firstResponseAt the first time. An internal note is staff-only and changes nothing else. A closed complaint accepts none (409)."
 *     tags: ["Store - Complaints"]
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
 *             required: [message]
 *             properties:
 *               message: { type: string, maxLength: 2000 }
 *               internal: { type: boolean, description: "not shown to the customer" }
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
 *         description: "The complaint is closed, or its thread is full."
 */
const commentOnComplaint = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await ComplaintService.comment(who(req), resolveStoreScope(req), id(req), req.body);
    return handleSuccessResponse({ statusCode: successCode, result }, res, "Comment added.");
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /complaints/{id}/escalate:
 *   post:
 *     operationId: escalateComplaint
 *     summary: "Escalate to management for a final decision"
 *     description: "**Who can call this:** admin, manager, staff (super_admin always allowed). Only an open, assigned or in-progress complaint can be escalated (409 otherwise). It then waits in the admin escalation queue; the store can no longer resolve it."
 *     tags: ["Store - Complaints"]
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
 *             required: [reason]
 *             properties:
 *               reason: { type: string, maxLength: 500 }
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
 *         description: "The complaint cannot be escalated from its current state."
 */
const escalateComplaint = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await ComplaintService.escalate(who(req), resolveStoreScope(req), id(req), req.body);
    return handleSuccessResponse({ statusCode: successCode, result }, res, "Complaint escalated.");
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /complaints/{id}/resolve:
 *   post:
 *     operationId: resolveComplaint
 *     summary: "Resolve a complaint"
 *     description: "**Who can call this:** admin, manager, staff (super_admin always allowed). Only an open, assigned or in-progress complaint (an escalated one waits for the admin decision, 409). A refundAmount needs a manager or admin (403 for staff) and may not exceed the order amount; it is recorded, not paid out by this service."
 *     tags: ["Store - Complaints"]
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
 *             required: [resolution]
 *             properties:
 *               resolution: { type: string, maxLength: 2000 }
 *               refundAmount: { type: number, description: "Amount in INR" }
 *               goodwill: { type: string, maxLength: 500 }
 *     responses:
 *       200:
 *         description: "The complaint with its history."
 *       400:
 *         description: "Missing or invalid fields."
 *       403:
 *         description: "Your role is not allowed to call this, or staff giving a refund."
 *       404:
 *         description: Not found.
 *       409:
 *         description: "The complaint cannot be resolved from its current state."
 */
const resolveComplaint = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await ComplaintService.resolve(who(req), resolveStoreScope(req), id(req), req.body);
    return handleSuccessResponse({ statusCode: successCode, result }, res, "Complaint resolved.");
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

export const StoreComplaintsController = {
  logComplaint,
  listComplaints,
  getComplaint,
  assignComplaint,
  commentOnComplaint,
  escalateComplaint,
  resolveComplaint,
};
