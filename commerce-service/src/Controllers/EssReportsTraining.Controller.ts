import { Response } from "express";
import { handleErrorResponse, handleSuccessResponse } from "../../commons/Response/Response.js";
import { created, successCode } from "../../commons/Utils/StatusCode.js";
import { IdentifiedRequest, RequestUser } from "../Middleware/Identity.js";
import { EssService } from "../Services/Ess.Service.js";

/**
 * @openapi
 * /hr/me/daily-reports:
 *   post:
 *     operationId: submitMyDailyReport
 *     summary: "Submit today's short end-of-day report"
 *     description: "**Who can call this:** admin, hr, manager, staff, driver (super_admin always allowed)."
 *     tags: ["Employee Self-Service - Reports & Training"]
 *     x-roles: [admin, hr, manager, staff, driver]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [date, summary]
 *             properties:
 *               date: { type: string, format: date }
 *               summary: { type: string }
 *               completed: { type: array, items: { type: string } }
 *               blockers: { type: string, description: "anything that held me up" }
 *               hoursWorked: { type: number }
 *     responses:
 *       201:
 *         description: "Created."
 *       400:
 *         description: "Missing or invalid fields."
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: "No employee record is linked to your login, or the record asked for is not yours."
 *       409:
 *         description: "A report for this date was already submitted."
 */
const submitMyDailyReport = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: created, result: await EssService.submitMyDailyReport((req.user as RequestUser).id, req.body) }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /hr/me/daily-reports:
 *   get:
 *     operationId: listMyDailyReports
 *     summary: "My past daily reports"
 *     description: "**Who can call this:** admin, hr, manager, staff, driver (super_admin always allowed)."
 *     tags: ["Employee Self-Service - Reports & Training"]
 *     x-roles: [admin, hr, manager, staff, driver]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, description: "1-based page number" }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, description: "page size, max 100" }
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
 *                               date: { type: string, format: date }
 *                               summary: { type: string }
 *                               blockers: { type: string }
 *                         page: { type: integer }
 *                         limit: { type: integer }
 *                         total: { type: integer }
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: "No employee record is linked to your login, or the record asked for is not yours."
 */
const listMyDailyReports = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await EssService.listMyDailyReports((req.user as RequestUser).id, req.query) }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /hr/me/training:
 *   get:
 *     operationId: listMyTraining
 *     summary: "What I have been assigned, completed, and what is due"
 *     description: "**Who can call this:** admin, hr, manager, staff, driver (super_admin always allowed)."
 *     tags: ["Employee Self-Service - Reports & Training"]
 *     x-roles: [admin, hr, manager, staff, driver]
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
 *                         assignments:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               id: { type: string, format: uuid }
 *                               courseTitle: { type: string }
 *                               status: { type: string }
 *                               dueDate: { type: string, format: date }
 *                               materialUrl: { type: string, format: uri }
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: "No employee record is linked to your login, or the record asked for is not yours."
 */
const listMyTraining = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await EssService.listMyTraining((req.user as RequestUser).id) }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /hr/me/training/{assignmentId}/complete:
 *   post:
 *     operationId: completeMyTraining
 *     summary: "Mark a course finished"
 *     description: "**Who can call this:** admin, hr, manager, staff, driver (super_admin always allowed)."
 *     tags: ["Employee Self-Service - Reports & Training"]
 *     x-roles: [admin, hr, manager, staff, driver]
 *     parameters:
 *       - in: path
 *         name: assignmentId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               score: { type: number }
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
const completeMyTraining = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await EssService.completeMyTraining((req.user as RequestUser).id, req.params.assignmentId, req.body) }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /hr/me/training/{assignmentId}/start:
 *   post:
 *     operationId: startMyTraining
 *     summary: "Start an assigned course"
 *     description: "**Who can call this:** admin, hr, manager, staff, driver (super_admin always allowed)."
 *     tags: ["Employee Self-Service - Reports & Training"]
 *     x-roles: [admin, hr, manager, staff, driver]
 *     parameters:
 *       - in: path
 *         name: assignmentId
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
const startMyTraining = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await EssService.startMyTraining((req.user as RequestUser).id, req.params.assignmentId) }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

export const EssReportsTrainingController = {
  submitMyDailyReport,
  listMyDailyReports,
  listMyTraining,
  completeMyTraining,
  startMyTraining,
};
