// @generated-scaffold — contract scaffold from the API catalogue; handlers answer 501 until built.
// Once you implement a handler, delete the first line so regeneration can never overwrite your work.
import { Request, Response } from "express";
import { handleErrorResponse, handleNotImplementedResponse } from "../../commons/Response/Response.js";
import { requireFields } from "../../commons/Utils/Validation.js";

/**
 * @openapi
 * /hr/career-paths:
 *   get:
 *     operationId: listCareerPaths
 *     summary: "The progression defined for each role"
 *     description: "**Who can call this:** admin, hr (super_admin always allowed)."
 *     tags: ["HR - Career Development"]
 *     x-roles: [admin, hr]
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
 *       403:
 *         description: Your role is not allowed to call this.
 *       501:
 *         description: "Scaffolded per API contract — implementation pending."
 */
const listCareerPaths = async (_req: Request, res: Response) => {
  try {
    return handleNotImplementedResponse(res);
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
 *       501:
 *         description: "Scaffolded per API contract — implementation pending."
 */
const setCareerPath = async (req: Request, res: Response) => {
  try {
    requireFields(req.body, ["nextRoles"]);
    return handleNotImplementedResponse(res);
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
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 *       501:
 *         description: "Scaffolded per API contract — implementation pending."
 */
const getCareerPlan = async (_req: Request, res: Response) => {
  try {
    return handleNotImplementedResponse(res);
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
 *       501:
 *         description: "Scaffolded per API contract — implementation pending."
 */
const setCareerPlan = async (_req: Request, res: Response) => {
  try {
    return handleNotImplementedResponse(res);
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
 *       501:
 *         description: "Scaffolded per API contract — implementation pending."
 */
const reviewCareerPlan = async (req: Request, res: Response) => {
  try {
    requireFields(req.body, ["note"]);
    return handleNotImplementedResponse(res);
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
