import { Response } from "express";
import { handleErrorResponse, handleSuccessResponse } from "../../commons/Response/Response.js";
import { created, successCode } from "../../commons/Utils/StatusCode.js";
import { IdentifiedRequest, RequestUser } from "../Middleware/Identity.js";
import { EssService } from "../Services/Ess.Service.js";

/**
 * @openapi
 * /hr/me/appraisals:
 *   get:
 *     operationId: listMyAppraisals
 *     summary: "My appraisals and their outcomes"
 *     description: "**Who can call this:** admin, hr, manager, staff, driver (super_admin always allowed)."
 *     tags: ["Employee Self-Service - Pay & Performance"]
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
 *                               cycle: { type: string }
 *                               scheduledFor: { type: string, format: date }
 *                               status: { type: string }
 *                               rating: { type: integer }
 *                               outcome: { type: string }
 *                         page: { type: integer }
 *                         limit: { type: integer }
 *                         total: { type: integer }
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: "No employee record is linked to your login, or the record asked for is not yours."
 */
const listMyAppraisals = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await EssService.listMyAppraisals((req.user as RequestUser).id, req.query) }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /hr/me/career-plan:
 *   get:
 *     operationId: getMyCareerPlan
 *     summary: "What I am working towards"
 *     description: "**Who can call this:** admin, hr, manager, staff, driver (super_admin always allowed)."
 *     tags: ["Employee Self-Service - Pay & Performance"]
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
 *                         targetRole: { type: string }
 *                         goals:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               title: { type: string }
 *                               targetDate: { type: string, format: date }
 *                               status: { type: string }
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: "No employee record is linked to your login, or the record asked for is not yours."
 */
const getMyCareerPlan = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await EssService.getMyCareerPlan((req.user as RequestUser).id) }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /hr/me/compensation:
 *   get:
 *     operationId: getMyCompensation
 *     summary: "My pay details"
 *     description: "**Who can call this:** admin, hr, manager, staff, driver (super_admin always allowed)."
 *     tags: ["Employee Self-Service - Pay & Performance"]
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
 *                         baseSalary: { type: number, description: "Amount in INR" }
 *                         payCycle: { type: string }
 *                         bonusEligible: { type: boolean }
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: "No employee record is linked to your login, or the record asked for is not yours."
 */
const getMyCompensation = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await EssService.getMyCompensation((req.user as RequestUser).id) }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /hr/me/earnings:
 *   get:
 *     operationId: getMyEarnings
 *     summary: "What I earned, what it was made of, and what has been paid"
 *     description: "**Who can call this:** admin, hr, manager, staff, driver (super_admin always allowed). So a pay disagreement starts from a shared record."
 *     tags: ["Employee Self-Service - Pay & Performance"]
 *     x-roles: [admin, hr, manager, staff, driver]
 *     parameters:
 *       - in: query
 *         name: month
 *         schema: { type: string, description: "YYYY-MM" }
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
 *                         base: { type: number, description: "Amount in INR" }
 *                         incentives:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               scheme: { type: string }
 *                               earned: { type: number, description: "Amount in INR" }
 *                               status: { type: string }
 *                         totalEarned: { type: number, description: "Amount in INR" }
 *                         paid: { type: number, description: "Amount in INR" }
 *                         due: { type: number, description: "Amount in INR" }
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: "No employee record is linked to your login, or the record asked for is not yours."
 */
const getMyEarnings = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await EssService.getMyEarnings((req.user as RequestUser).id, req.query) }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /hr/me/payouts:
 *   get:
 *     operationId: listMyPayouts
 *     summary: "Payments I have received"
 *     description: "**Who can call this:** admin, hr, manager, staff, driver (super_admin always allowed)."
 *     tags: ["Employee Self-Service - Pay & Performance"]
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
 *                               amount: { type: number, description: "Amount in INR" }
 *                               type: { type: string }
 *                               period: { type: string }
 *                               paidOn: { type: string, format: date }
 *                         page: { type: integer }
 *                         limit: { type: integer }
 *                         total: { type: integer }
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: "No employee record is linked to your login, or the record asked for is not yours."
 */
const listMyPayouts = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await EssService.listMyPayouts((req.user as RequestUser).id, req.query) }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /hr/me/performance:
 *   get:
 *     operationId: getMyPerformance
 *     summary: "How I am tracking"
 *     description: "**Who can call this:** admin, hr, manager, staff, driver (super_admin always allowed)."
 *     tags: ["Employee Self-Service - Pay & Performance"]
 *     x-roles: [admin, hr, manager, staff, driver]
 *     parameters:
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
 *                               trend: { type: string }
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: "No employee record is linked to your login, or the record asked for is not yours."
 */
const getMyPerformance = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await EssService.getMyPerformance((req.user as RequestUser).id, req.query) }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /hr/me/profile:
 *   get:
 *     operationId: getMyEmploymentProfile
 *     summary: "My employment details"
 *     description: "**Who can call this:** admin, hr, manager, staff, driver (super_admin always allowed)."
 *     tags: ["Employee Self-Service - Pay & Performance"]
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
 *                         id: { type: string, format: uuid }
 *                         name: { type: string }
 *                         role: { type: string }
 *                         storeId: { type: string, format: uuid }
 *                         joinDate: { type: string, format: date }
 *                         phone: { type: string, description: "E.164 phone number, e.g. +919876543210" }
 *                         email: { type: string, format: email }
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: "No employee record is linked to your login, or the record asked for is not yours."
 */
const getMyEmploymentProfile = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await EssService.getMyEmploymentProfile((req.user as RequestUser).id) }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /hr/me/profile:
 *   patch:
 *     operationId: updateMyEmploymentProfile
 *     summary: "Update my contact details"
 *     description: "**Who can call this:** admin, hr, manager, staff, driver (super_admin always allowed)."
 *     tags: ["Employee Self-Service - Pay & Performance"]
 *     x-roles: [admin, hr, manager, staff, driver]
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               phone: { type: string, description: "E.164 phone number, e.g. +919876543210" }
 *               email: { type: string, format: email }
 *               address: { type: string }
 *               emergencyContact:
 *                 type: object
 *                 properties:
 *                   name: { type: string }
 *                   phone: { type: string, description: "E.164 phone number, e.g. +919876543210" }
 *                   relation: { type: string }
 *     responses:
 *       200:
 *         description: "OK."
 *       400:
 *         description: "Missing or invalid fields."
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: "No employee record is linked to your login, or the record asked for is not yours."
 */
const updateMyEmploymentProfile = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await EssService.updateMyEmploymentProfile(req.user as RequestUser, req.body) }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

export const EssPayPerformanceController = {
  listMyAppraisals,
  getMyCareerPlan,
  getMyCompensation,
  getMyEarnings,
  listMyPayouts,
  getMyPerformance,
  getMyEmploymentProfile,
  updateMyEmploymentProfile,
};
