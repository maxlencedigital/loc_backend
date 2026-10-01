import { Response } from "express";
import { handleErrorResponse, handleSuccessResponse } from "../../commons/Response/Response.js";
import { created, successCode } from "../../commons/Utils/StatusCode.js";
import { IdentifiedRequest, RequestUser } from "../Middleware/Identity.js";
import { resolveStoreScope } from "../Middleware/StoreScope.js";
import { GrievanceService } from "../Services/Grievance.Service.js";
import { HrRequestService } from "../Services/HrRequest.Service.js";

/**
 * @openapi
 * /hr/grievances:
 *   get:
 *     operationId: listGrievances
 *     summary: "Concerns employees have raised"
 *     description: "**Who can call this:** admin, hr (super_admin always allowed)."
 *     tags: ["HR - Grievances & Requests"]
 *     x-roles: [admin, hr]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, description: "1-based page number" }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, description: "page size, max 100" }
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [open, assigned, in_progress, escalated, closed] }
 *       - in: query
 *         name: category
 *         schema: { type: string }
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
 *                               category: { type: string }
 *                               status: { type: string, enum: [open, assigned, in_progress, escalated, closed] }
 *                               assigneeId: { type: string, format: uuid }
 *                               raisedAt: { type: string, format: date-time }
 *                               anonymous: { type: boolean }
 *                         page: { type: integer }
 *                         limit: { type: integer }
 *                         total: { type: integer }
 *       403:
 *         description: Your role is not allowed to call this.
 */
const listGrievances = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await GrievanceService.list(req.user as RequestUser, resolveStoreScope(req), req.query) }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /hr/grievances/{id}:
 *   get:
 *     operationId: getGrievance
 *     summary: "One grievance, with its confidential history"
 *     description: "**Who can call this:** admin, hr (super_admin always allowed)."
 *     tags: ["HR - Grievances & Requests"]
 *     x-roles: [admin, hr]
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
const getGrievance = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await GrievanceService.get(req.user as RequestUser, resolveStoreScope(req), req.params.id) }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /hr/grievances/{id}/assign:
 *   post:
 *     operationId: assignGrievance
 *     summary: "Assign a grievance to someone"
 *     description: "**Who can call this:** admin, hr (super_admin always allowed)."
 *     tags: ["HR - Grievances & Requests"]
 *     x-roles: [admin, hr]
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
 *         description: "OK."
 *       400:
 *         description: "Missing or invalid fields."
 *       409:
 *         description: "The grievance is closed, or the assignee is the person it concerns."
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 */
const assignGrievance = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await GrievanceService.assign(req.user as RequestUser, resolveStoreScope(req), req.params.id, req.body) }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /hr/grievances/{id}/close:
 *   post:
 *     operationId: closeGrievance
 *     summary: "Close with a recorded outcome"
 *     description: "**Who can call this:** admin, hr (super_admin always allowed)."
 *     tags: ["HR - Grievances & Requests"]
 *     x-roles: [admin, hr]
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
 *             required: [outcome]
 *             properties:
 *               outcome: { type: string }
 *     responses:
 *       200:
 *         description: "OK."
 *       400:
 *         description: "Missing or invalid fields."
 *       409:
 *         description: "The grievance is already closed."
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 */
const closeGrievance = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await GrievanceService.close(req.user as RequestUser, resolveStoreScope(req), req.params.id, req.body) }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /hr/grievances/{id}/comments:
 *   post:
 *     operationId: commentOnGrievance
 *     summary: "Add to a grievance"
 *     description: "**Who can call this:** admin, hr (super_admin always allowed)."
 *     tags: ["HR - Grievances & Requests"]
 *     x-roles: [admin, hr]
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
 *               message: { type: string }
 *               internal: { type: boolean }
 *     responses:
 *       200:
 *         description: "OK."
 *       400:
 *         description: "Missing or invalid fields."
 *       409:
 *         description: "The grievance is closed."
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 */
const commentOnGrievance = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await GrievanceService.comment(req.user as RequestUser, resolveStoreScope(req), req.params.id, req.body) }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /hr/grievances/{id}/escalate:
 *   post:
 *     operationId: escalateGrievance
 *     summary: "Escalate to management"
 *     description: "**Who can call this:** admin, hr (super_admin always allowed)."
 *     tags: ["HR - Grievances & Requests"]
 *     x-roles: [admin, hr]
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
 *               reason: { type: string }
 *     responses:
 *       200:
 *         description: "OK."
 *       400:
 *         description: "Missing or invalid fields."
 *       409:
 *         description: "The grievance is already escalated or closed."
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 */
const escalateGrievance = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await GrievanceService.escalate(req.user as RequestUser, resolveStoreScope(req), req.params.id, req.body) }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /hr/requests:
 *   get:
 *     operationId: listHrRequests
 *     summary: "Questions and requests sent to HR"
 *     description: "**Who can call this:** admin, hr (super_admin always allowed)."
 *     tags: ["HR - Grievances & Requests"]
 *     x-roles: [admin, hr]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, description: "1-based page number" }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, description: "page size, max 100" }
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [open, answered, closed] }
 *       - in: query
 *         name: category
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
 *                               employeeId: { type: string, format: uuid }
 *                               category: { type: string }
 *                               status: { type: string, enum: [open, answered, closed] }
 *                               createdAt: { type: string, format: date-time }
 *                         page: { type: integer }
 *                         limit: { type: integer }
 *                         total: { type: integer }
 *       403:
 *         description: Your role is not allowed to call this.
 */
const listHrRequests = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await HrRequestService.list(resolveStoreScope(req), req.query) }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /hr/requests/{id}:
 *   get:
 *     operationId: getHrRequest
 *     summary: "One HR request"
 *     description: "**Who can call this:** admin, hr (super_admin always allowed)."
 *     tags: ["HR - Grievances & Requests"]
 *     x-roles: [admin, hr]
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
const getHrRequest = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await HrRequestService.get(resolveStoreScope(req), req.params.id) }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /hr/requests/{id}/close:
 *   post:
 *     operationId: closeHrRequest
 *     summary: "Close an HR request"
 *     description: "**Who can call this:** admin, hr (super_admin always allowed)."
 *     tags: ["HR - Grievances & Requests"]
 *     x-roles: [admin, hr]
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
 *       409:
 *         description: "The request is already closed."
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 */
const closeHrRequest = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await HrRequestService.close(resolveStoreScope(req), req.params.id, req.body) }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /hr/requests/{id}/respond:
 *   post:
 *     operationId: respondToHrRequest
 *     summary: "Answer an HR request"
 *     description: "**Who can call this:** admin, hr (super_admin always allowed)."
 *     tags: ["HR - Grievances & Requests"]
 *     x-roles: [admin, hr]
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
 *               message: { type: string }
 *     responses:
 *       200:
 *         description: "OK."
 *       400:
 *         description: "Missing or invalid fields."
 *       409:
 *         description: "The request was already answered or closed."
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 */
const respondToHrRequest = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await HrRequestService.respond(req.user as RequestUser, resolveStoreScope(req), req.params.id, req.body) }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

export const HrGrievancesController = {
  listGrievances,
  getGrievance,
  assignGrievance,
  closeGrievance,
  commentOnGrievance,
  escalateGrievance,
  listHrRequests,
  getHrRequest,
  closeHrRequest,
  respondToHrRequest,
};
