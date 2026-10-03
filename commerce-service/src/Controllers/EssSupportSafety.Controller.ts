import { Response } from "express";
import { handleErrorResponse, handleSuccessResponse } from "../../commons/Response/Response.js";
import { created, successCode } from "../../commons/Utils/StatusCode.js";
import { IdentifiedRequest, RequestUser } from "../Middleware/Identity.js";
import { EssService } from "../Services/Ess.Service.js";

/**
 * @openapi
 * /hr/me/grievances:
 *   post:
 *     operationId: raiseMyGrievance
 *     summary: "Raise a concern, confidentially"
 *     description: "**Who can call this:** admin, hr, manager, staff, driver (super_admin always allowed)."
 *     tags: ["Employee Self-Service - Support & Safety"]
 *     x-roles: [admin, hr, manager, staff, driver]
 *     parameters:
 *       - in: header
 *         name: Idempotency-Key
 *         description: "Optional, 8 to 80 characters. A retry with the same key returns the first record (200) instead of creating another."
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [category, description]
 *             properties:
 *               category: { type: string, enum: [harassment, pay, workload, safety, management, discrimination, other] }
 *               description: { type: string }
 *               anonymous: { type: boolean }
 *     responses:
 *       201:
 *         description: "Created."
 *       400:
 *         description: "Missing or invalid fields."
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: "No employee record is linked to your login, or the record asked for is not yours."
 */
const raiseMyGrievance = async (req: IdentifiedRequest, res: Response) => {
  try {
    const { replayed, result } = await EssService.raiseMyGrievance((req.user as RequestUser).id, req.body, req.header("idempotency-key"));
    return handleSuccessResponse({ statusCode: replayed ? successCode : created, result }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /hr/me/grievances:
 *   get:
 *     operationId: listMyGrievances
 *     summary: "Concerns I have raised"
 *     description: "**Who can call this:** admin, hr, manager, staff, driver (super_admin always allowed)."
 *     tags: ["Employee Self-Service - Support & Safety"]
 *     x-roles: [admin, hr, manager, staff, driver]
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
 *                               raisedAt: { type: string, format: date-time }
 *                         page: { type: integer }
 *                         limit: { type: integer }
 *                         total: { type: integer }
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: "No employee record is linked to your login, or the record asked for is not yours."
 */
const listMyGrievances = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await EssService.listMyGrievances((req.user as RequestUser).id, req.query) }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /hr/me/grievances/{id}:
 *   get:
 *     operationId: getMyGrievance
 *     summary: "One of my concerns and its progress"
 *     description: "**Who can call this:** admin, hr, manager, staff, driver (super_admin always allowed)."
 *     tags: ["Employee Self-Service - Support & Safety"]
 *     x-roles: [admin, hr, manager, staff, driver]
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
const getMyGrievance = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await EssService.getMyGrievance((req.user as RequestUser).id, req.params.id) }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /hr/me/incidents:
 *   get:
 *     operationId: listMyIncidents
 *     summary: "Incidents I have reported"
 *     description: "**Who can call this:** admin, hr, manager, staff, driver (super_admin always allowed)."
 *     tags: ["Employee Self-Service - Support & Safety"]
 *     x-roles: [admin, hr, manager, staff, driver]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, description: "1-based page number" }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, description: "page size, max 100" }
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
 *                               type: { type: string }
 *                               status: { type: string }
 *                               occurredAt: { type: string, format: date-time }
 *                         page: { type: integer }
 *                         limit: { type: integer }
 *                         total: { type: integer }
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: "No employee record is linked to your login, or the record asked for is not yours."
 */
const listMyIncidents = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await EssService.listMyIncidents((req.user as RequestUser).id, req.query) }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /hr/me/requests:
 *   post:
 *     operationId: sendMyHrRequest
 *     summary: "Ask HR a question or make a request"
 *     description: "**Who can call this:** admin, hr, manager, staff, driver (super_admin always allowed)."
 *     tags: ["Employee Self-Service - Support & Safety"]
 *     x-roles: [admin, hr, manager, staff, driver]
 *     parameters:
 *       - in: header
 *         name: Idempotency-Key
 *         description: "Optional, 8 to 80 characters. A retry with the same key returns the first record (200) instead of creating another."
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [category, message]
 *             properties:
 *               category: { type: string, enum: [leave_policy, payroll, documents, benefits, other] }
 *               message: { type: string }
 *     responses:
 *       201:
 *         description: "Created."
 *       400:
 *         description: "Missing or invalid fields."
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: "No employee record is linked to your login, or the record asked for is not yours."
 */
const sendMyHrRequest = async (req: IdentifiedRequest, res: Response) => {
  try {
    const { replayed, result } = await EssService.sendMyHrRequest((req.user as RequestUser).id, req.body, req.header("idempotency-key"));
    return handleSuccessResponse({ statusCode: replayed ? successCode : created, result }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /hr/me/requests:
 *   get:
 *     operationId: listMyHrRequests
 *     summary: "My HR requests"
 *     description: "**Who can call this:** admin, hr, manager, staff, driver (super_admin always allowed)."
 *     tags: ["Employee Self-Service - Support & Safety"]
 *     x-roles: [admin, hr, manager, staff, driver]
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
 *                               status: { type: string, enum: [open, answered, closed] }
 *                               createdAt: { type: string, format: date-time }
 *                         page: { type: integer }
 *                         limit: { type: integer }
 *                         total: { type: integer }
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: "No employee record is linked to your login, or the record asked for is not yours."
 */
const listMyHrRequests = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await EssService.listMyHrRequests((req.user as RequestUser).id, req.query) }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /hr/me/requests/{id}:
 *   get:
 *     operationId: getMyHrRequest
 *     summary: "One of my HR requests and the reply"
 *     description: "**Who can call this:** admin, hr, manager, staff, driver (super_admin always allowed)."
 *     tags: ["Employee Self-Service - Support & Safety"]
 *     x-roles: [admin, hr, manager, staff, driver]
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
const getMyHrRequest = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await EssService.getMyHrRequest((req.user as RequestUser).id, req.params.id) }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

export const EssSupportSafetyController = {
  raiseMyGrievance,
  listMyGrievances,
  getMyGrievance,
  listMyIncidents,
  sendMyHrRequest,
  listMyHrRequests,
  getMyHrRequest,
};
