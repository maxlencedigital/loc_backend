import { Response } from "express";
import { handleErrorResponse, handleSuccessResponse } from "../../commons/Response/Response.js";
import { successCode } from "../../commons/Utils/StatusCode.js";
import { IdentifiedRequest, RequestUser } from "../Middleware/Identity.js";
import { resolveStoreScope } from "../Middleware/StoreScope.js";
import { CareerService } from "../Services/Career.Service.js";

/**
 * @openapi
 * /hr/career-paths:
 *   get:
 *     operationId: listCareerPaths
 *     summary: "The progression defined for each role"
 *     description: "**Who can call this:** admin, hr (super_admin always allowed)."
 *     tags: ["HR - Career Development"]
 *     x-roles: [admin, hr]
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
 *                         paths:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               role: { type: string }
 *                               nextRoles: { type: array, items: { type: string } }
 *                               requirements: { type: array, items: { type: string } }
 *                         page: { type: integer }
 *                         limit: { type: integer }
 *                         total: { type: integer }
 *       403:
 *         description: Your role is not allowed to call this.
 */
const listCareerPaths = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await CareerService.listPaths(req.query) }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /hr/career-paths/{role}:
 *   put:
 *     operationId: setCareerPath
 *     summary: "Define the progression for a role"
 *     description: "**Who can call this:** admin, hr (super_admin always allowed)."
 *     tags: ["HR - Career Development"]
 *     x-roles: [admin, hr]
 *     parameters:
 *       - in: path
 *         name: role
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [nextRoles]
 *             properties:
 *               nextRoles: { type: array, items: { type: string } }
 *               requirements: { type: array, items: { type: string } }
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
const setCareerPath = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await CareerService.setPath(req.params.role, req.body) }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /hr/employees/{id}/career-plan:
 *   get:
 *     operationId: getCareerPlan
 *     summary: "What someone is working towards and what has been agreed"
 *     description: "**Who can call this:** admin, hr (super_admin always allowed)."
 *     tags: ["HR - Career Development"]
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
 *                         targetRole: { type: string }
 *                         goals:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               title: { type: string }
 *                               targetDate: { type: string, format: date }
 *                               status: { type: string, enum: [planned, in_progress, done] }
 *                         skillGaps: { type: array, items: { type: string } }
 *                         agreedActions:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               action: { type: string }
 *                               owner: { type: string }
 *                               dueDate: { type: string, format: date }
 *                         lastReviewedAt: { type: string, format: date-time }
 *                         employeeId: { type: string, format: uuid }
 *                         history:
 *                           type: array
 *                           description: "append-only changes of designation, store, pay grade and status, latest first"
 *                           items:
 *                             type: object
 *                             properties:
 *                               field: { type: string }
 *                               from: { type: string, nullable: true }
 *                               to: { type: string, nullable: true }
 *                               effectiveDate: { type: string, format: date }
 *                               reason: { type: string, nullable: true }
 *                               changedBy: { type: string }
 *                               at: { type: string, format: date-time }
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 */
const getCareerPlan = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await CareerService.getPlan(req.params.id, resolveStoreScope(req)) }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /hr/employees/{id}/career-plan:
 *   put:
 *     operationId: setCareerPlan
 *     summary: "Set or update someone's career plan"
 *     description: "**Who can call this:** admin, hr (super_admin always allowed)."
 *     tags: ["HR - Career Development"]
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
 *               targetRole: { type: string }
 *               goals:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required: [title]
 *                   properties:
 *                     title: { type: string }
 *                     targetDate: { type: string, format: date }
 *                     status: { type: string, enum: [planned, in_progress, done] }
 *               skillGaps: { type: array, items: { type: string } }
 *               agreedActions:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required: [action]
 *                   properties:
 *                     action: { type: string }
 *                     owner: { type: string }
 *                     dueDate: { type: string, format: date }
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
const setCareerPlan = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await CareerService.setPlan(req.params.id, resolveStoreScope(req), req.body) }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /hr/employees/{id}/career-plan/review:
 *   post:
 *     operationId: reviewCareerPlan
 *     summary: "Record that the plan was reviewed"
 *     description: "**Who can call this:** admin, hr (super_admin always allowed)."
 *     tags: ["HR - Career Development"]
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
 *             required: [note]
 *             properties:
 *               note: { type: string }
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
const reviewCareerPlan = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await CareerService.reviewPlan(req.params.id, resolveStoreScope(req), req.user as RequestUser, req.body) }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

export const HrCareerController = {
  listCareerPaths,
  setCareerPath,
  getCareerPlan,
  setCareerPlan,
  reviewCareerPlan,
};
