import { Response } from "express";
import { handleErrorResponse, handleSuccessResponse } from "../../commons/Response/Response.js";
import { created, successCode } from "../../commons/Utils/StatusCode.js";
import { IdentifiedRequest, RequestUser } from "../Middleware/Identity.js";
import { resolveStoreScope } from "../Middleware/StoreScope.js";
import { PerformanceService } from "../Services/Performance.Service.js";

/**
 * @openapi
 * /hr/appraisals:
 *   get:
 *     operationId: listAppraisals
 *     summary: "List appraisals"
 *     description: "**Who can call this:** admin, hr (super_admin always allowed)."
 *     tags: ["HR - Performance & Appraisals"]
 *     x-roles: [admin, hr]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, description: "1-based page number" }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, description: "page size, max 100" }
 *       - in: query
 *         name: employeeId
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [scheduled, in_progress, completed] }
 *       - in: query
 *         name: cycle
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
 *                               cycle: { type: string, description: "e.g. 2026-H2" }
 *                               scheduledFor: { type: string, format: date }
 *                               reviewerId: { type: string, format: uuid }
 *                               status: { type: string, enum: [scheduled, in_progress, completed] }
 *                               createdAt: { type: string, format: date-time }
 *                               updatedAt: { type: string, format: date-time }
 *                         page: { type: integer }
 *                         limit: { type: integer }
 *                         total: { type: integer }
 *       403:
 *         description: Your role is not allowed to call this.
 */
const listAppraisals = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await PerformanceService.listAppraisals(resolveStoreScope(req), req.query) }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /hr/appraisals:
 *   post:
 *     operationId: createAppraisal
 *     summary: "Create an appraisal"
 *     description: "**Who can call this:** admin, hr (super_admin always allowed)."
 *     tags: ["HR - Performance & Appraisals"]
 *     x-roles: [admin, hr]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [employeeId, cycle, scheduledFor]
 *             properties:
 *               employeeId: { type: string, format: uuid }
 *               cycle: { type: string, description: "e.g. 2026-H2" }
 *               scheduledFor: { type: string, format: date }
 *               reviewerId: { type: string, format: uuid }
 *               status: { type: string, enum: [scheduled, in_progress, completed] }
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
 *                         employeeId: { type: string, format: uuid }
 *                         cycle: { type: string, description: "e.g. 2026-H2" }
 *                         scheduledFor: { type: string, format: date }
 *                         reviewerId: { type: string, format: uuid }
 *                         status: { type: string, enum: [scheduled, in_progress, completed] }
 *                         createdAt: { type: string, format: date-time }
 *                         updatedAt: { type: string, format: date-time }
 *       400:
 *         description: "Missing or invalid fields."
 *       409:
 *         description: "This person already has an appraisal for that cycle."
 *       403:
 *         description: Your role is not allowed to call this.
 */
const createAppraisal = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: created, result: await PerformanceService.createAppraisal(req.user as RequestUser, resolveStoreScope(req), req.body) }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /hr/appraisals/schedule:
 *   post:
 *     operationId: scheduleAppraisals
 *     summary: "Schedule appraisals for several people at once"
 *     description: "**Who can call this:** admin, hr (super_admin always allowed)."
 *     tags: ["HR - Performance & Appraisals"]
 *     x-roles: [admin, hr]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [employeeIds, scheduledFor]
 *             properties:
 *               employeeIds: { type: array, items: { type: string, format: uuid } }
 *               scheduledFor: { type: string, format: date }
 *               cycle: { type: string }
 *     responses:
 *       200:
 *         description: "OK."
 *       400:
 *         description: "Missing or invalid fields."
 *       403:
 *         description: Your role is not allowed to call this.
 */
const scheduleAppraisals = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await PerformanceService.scheduleAppraisals(req.user as RequestUser, resolveStoreScope(req), req.body) }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /hr/appraisals/{id}:
 *   get:
 *     operationId: getAppraisal
 *     summary: "Get an appraisal"
 *     description: "**Who can call this:** admin, hr (super_admin always allowed)."
 *     tags: ["HR - Performance & Appraisals"]
 *     x-roles: [admin, hr]
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
 *                         id: { type: string, format: uuid }
 *                         employeeId: { type: string, format: uuid }
 *                         cycle: { type: string, description: "e.g. 2026-H2" }
 *                         scheduledFor: { type: string, format: date }
 *                         reviewerId: { type: string, format: uuid }
 *                         status: { type: string, enum: [scheduled, in_progress, completed] }
 *                         createdAt: { type: string, format: date-time }
 *                         updatedAt: { type: string, format: date-time }
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 */
const getAppraisal = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await PerformanceService.getAppraisal(req.params.id, resolveStoreScope(req)) }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /hr/appraisals/{id}:
 *   patch:
 *     operationId: updateAppraisal
 *     summary: "Update an appraisal"
 *     description: "**Who can call this:** admin, hr (super_admin always allowed)."
 *     tags: ["HR - Performance & Appraisals"]
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
 *               employeeId: { type: string, format: uuid }
 *               cycle: { type: string, description: "e.g. 2026-H2" }
 *               scheduledFor: { type: string, format: date }
 *               reviewerId: { type: string, format: uuid }
 *               status: { type: string, enum: [scheduled, in_progress, completed] }
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
 *                         id: { type: string, format: uuid }
 *                         employeeId: { type: string, format: uuid }
 *                         cycle: { type: string, description: "e.g. 2026-H2" }
 *                         scheduledFor: { type: string, format: date }
 *                         reviewerId: { type: string, format: uuid }
 *                         status: { type: string, enum: [scheduled, in_progress, completed] }
 *                         createdAt: { type: string, format: date-time }
 *                         updatedAt: { type: string, format: date-time }
 *       400:
 *         description: "Missing or invalid fields."
 *       409:
 *         description: "The appraisal has started and can no longer be rescheduled."
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 */
const updateAppraisal = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await PerformanceService.updateAppraisal(req.params.id, resolveStoreScope(req), req.body) }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /hr/appraisals/{id}/complete:
 *   post:
 *     operationId: completeAppraisal
 *     summary: "Close the appraisal with its outcome"
 *     description: "**Who can call this:** admin, hr (super_admin always allowed)."
 *     tags: ["HR - Performance & Appraisals"]
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
 *               outcome: { type: string, enum: [promoted, increment, no_change, improvement_plan, other] }
 *               note: { type: string }
 *     responses:
 *       200:
 *         description: "OK."
 *       400:
 *         description: "Missing or invalid fields."
 *       409:
 *         description: "The appraisal was not conducted yet, or is already completed."
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 */
const completeAppraisal = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await PerformanceService.completeAppraisal(req.user as RequestUser, req.params.id, resolveStoreScope(req), req.body) }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /hr/appraisals/{id}/conduct:
 *   post:
 *     operationId: conductAppraisal
 *     summary: "Record how the review went"
 *     description: "**Who can call this:** admin, hr (super_admin always allowed)."
 *     tags: ["HR - Performance & Appraisals"]
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
 *             required: [rating]
 *             properties:
 *               rating: { type: integer }
 *               strengths: { type: string }
 *               improvements: { type: string }
 *               goals: { type: array, items: { type: string } }
 *     responses:
 *       200:
 *         description: "OK."
 *       400:
 *         description: "Missing or invalid fields."
 *       409:
 *         description: "The rating was already recorded and cannot change."
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 */
const conductAppraisal = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await PerformanceService.conductAppraisal(req.user as RequestUser, req.params.id, resolveStoreScope(req), req.body) }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /hr/performance/employees/{id}:
 *   get:
 *     operationId: getEmployeePerformance
 *     summary: "How someone is doing against what their role asks, over time"
 *     description: "**Who can call this:** admin, hr, manager (super_admin always allowed). A continuous record, so a review rests on more than the last fortnight's memory."
 *     tags: ["HR - Performance & Appraisals"]
 *     x-roles: [admin, hr, manager]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
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
 *                         score: { type: number }
 *                         metrics:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               name: { type: string }
 *                               target: { type: number }
 *                               actual: { type: number }
 *                               trend: { type: string, enum: [up, flat, down] }
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 */
const getEmployeePerformance = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await PerformanceService.getEmployeePerformance(req.params.id, resolveStoreScope(req), req.query) }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /hr/performance/summary:
 *   get:
 *     operationId: getPerformanceSummary
 *     summary: "Performance across a store or the business"
 *     description: "**Who can call this:** admin, hr, manager (super_admin always allowed)."
 *     tags: ["HR - Performance & Appraisals"]
 *     x-roles: [admin, hr, manager]
 *     parameters:
 *       - in: query
 *         name: storeId
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: period
 *         schema: { type: string, description: "e.g. 2026-09" }
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
 *                         employees:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               employeeId: { type: string, format: uuid }
 *                               name: { type: string }
 *                               score: { type: number }
 *                               rank: { type: integer }
 *       403:
 *         description: Your role is not allowed to call this.
 */
const getPerformanceSummary = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await PerformanceService.getSummary(resolveStoreScope(req), req.query) }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

export const HrPerformanceController = {
  listAppraisals,
  createAppraisal,
  scheduleAppraisals,
  getAppraisal,
  updateAppraisal,
  completeAppraisal,
  conductAppraisal,
  getEmployeePerformance,
  getPerformanceSummary,
};
