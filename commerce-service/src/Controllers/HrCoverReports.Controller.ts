import { Response } from "express";
import { handleErrorResponse, handleSuccessResponse } from "../../commons/Response/Response.js";
import { successCode } from "../../commons/Utils/StatusCode.js";
import { IdentifiedRequest, RequestUser } from "../Middleware/Identity.js";
import { resolveStoreScope } from "../Middleware/StoreScope.js";
import { CoverReportService } from "../Services/CoverReport.Service.js";

/**
 * @openapi
 * /hr/absence-cover:
 *   get:
 *     operationId: getAbsenceCover
 *     summary: "What absent people were meant to handle, and who could cover"
 *     description: "**Who can call this:** admin, hr, manager (super_admin always allowed). So the day's work is reassigned, not discovered when a customer complains."
 *     tags: ["HR - Absence Cover & Daily Reports"]
 *     x-roles: [admin, hr, manager]
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
 *                         absent:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               employeeId: { type: string, format: uuid }
 *                               name: { type: string }
 *                               reason: { type: string }
 *                               assigned:
 *                                 type: object
 *                                 properties:
 *                                   orders: { type: integer }
 *                                   batches: { type: integer }
 *                                   routes: { type: integer }
 *                         availableCover:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               employeeId: { type: string, format: uuid }
 *                               name: { type: string }
 *                               skills: { type: array, items: { type: string } }
 *                         date: { type: string, format: date }
 *                         assignmentsTracked: { type: boolean, description: "false until orders, batches and routes record who is assigned them; the assigned counts read 0" }
 *       403:
 *         description: Your role is not allowed to call this.
 */
const getAbsenceCover = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await CoverReportService.absenceCover(resolveStoreScope(req), req.query) }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /hr/absence-cover/reassign:
 *   post:
 *     operationId: reassignAbsentWork
 *     summary: "Hand an absent person's work to someone who is in"
 *     description: "**Who can call this:** admin, hr, manager (super_admin always allowed)."
 *     tags: ["HR - Absence Cover & Daily Reports"]
 *     x-roles: [admin, hr, manager]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [fromEmployeeId, toEmployeeId, date]
 *             properties:
 *               fromEmployeeId: { type: string, format: uuid }
 *               toEmployeeId: { type: string, format: uuid }
 *               date: { type: string, format: date }
 *               workItemIds: { type: array, items: { type: string, format: uuid } }
 *     responses:
 *       200:
 *         description: "OK."
 *       400:
 *         description: "Missing or invalid fields."
 *       409:
 *         description: "The absent person was in, or the cover is not in."
 *       403:
 *         description: Your role is not allowed to call this.
 */
const reassignAbsentWork = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await CoverReportService.reassign(resolveStoreScope(req), req.user as RequestUser, req.body) }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /hr/daily-reports:
 *   get:
 *     operationId: listDailyReports
 *     summary: "End-of-day reports from the team"
 *     description: "**Who can call this:** admin, hr, manager (super_admin always allowed)."
 *     tags: ["HR - Absence Cover & Daily Reports"]
 *     x-roles: [admin, hr, manager]
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
 *       - in: query
 *         name: employeeId
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
 *                               employeeId: { type: string, format: uuid }
 *                               name: { type: string }
 *                               date: { type: string, format: date }
 *                               summary: { type: string }
 *                               blockers: { type: string }
 *                         page: { type: integer }
 *                         limit: { type: integer }
 *                         total: { type: integer }
 *       403:
 *         description: Your role is not allowed to call this.
 */
const listDailyReports = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await CoverReportService.listDaily(resolveStoreScope(req), req.query) }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /hr/daily-reports/patterns:
 *   get:
 *     operationId: getDailyReportPatterns
 *     summary: "Recurring blockers across a week, not buried in individual messages"
 *     description: "**Who can call this:** admin, hr, manager (super_admin always allowed)."
 *     tags: ["HR - Absence Cover & Daily Reports"]
 *     x-roles: [admin, hr, manager]
 *     parameters:
 *       - in: query
 *         name: storeId
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: weeks
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
 *                         recurringBlockers:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               theme: { type: string }
 *                               count: { type: integer }
 *                               examples: { type: array, items: { type: string } }
 *       403:
 *         description: Your role is not allowed to call this.
 */
const getDailyReportPatterns = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await CoverReportService.patterns(resolveStoreScope(req), req.query) }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /hr/daily-reports/{id}:
 *   get:
 *     operationId: getDailyReport
 *     summary: "One daily report"
 *     description: "**Who can call this:** admin, hr, manager (super_admin always allowed)."
 *     tags: ["HR - Absence Cover & Daily Reports"]
 *     x-roles: [admin, hr, manager]
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
const getDailyReport = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await CoverReportService.getDaily(req.params.id, resolveStoreScope(req)) }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

export const HrCoverReportsController = {
  getAbsenceCover,
  reassignAbsentWork,
  listDailyReports,
  getDailyReportPatterns,
  getDailyReport,
};
