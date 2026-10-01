import { Response } from "express";
import { handleErrorResponse, handleSuccessResponse } from "../../commons/Response/Response.js";
import { created, successCode } from "../../commons/Utils/StatusCode.js";
import { IdentifiedRequest, RequestUser } from "../Middleware/Identity.js";
import { resolveStoreScope } from "../Middleware/StoreScope.js";
import { PayService } from "../Services/Pay.Service.js";
import { idempotencyKeyOf } from "../Utils/PeopleInput.js";

/**
 * @openapi
 * /hr/employees/{id}/compensation:
 *   get:
 *     operationId: getCompensation
 *     summary: "Salary and pay terms"
 *     description: "**Who can call this:** admin, hr (super_admin always allowed)."
 *     tags: ["HR - Pay & Incentives"]
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
 *                         baseSalary: { type: number, description: "Amount in INR" }
 *                         payCycle: { type: string }
 *                         allowances: { type: object }
 *                         bonusEligible: { type: boolean }
 *                         effectiveFrom: { type: string, format: date }
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 */
const getCompensation = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await PayService.getCompensation(req.params.id, resolveStoreScope(req)) }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /hr/employees/{id}/compensation:
 *   put:
 *     operationId: setCompensation
 *     summary: "Set salary and pay terms"
 *     description: "**Who can call this:** admin, hr (super_admin always allowed)."
 *     tags: ["HR - Pay & Incentives"]
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
 *             required: [baseSalary, effectiveFrom]
 *             properties:
 *               baseSalary: { type: number, description: "Amount in INR" }
 *               payCycle: { type: string, enum: [monthly, weekly, per_job] }
 *               allowances: { type: object }
 *               bonusEligible: { type: boolean }
 *               effectiveFrom: { type: string, format: date }
 *     responses:
 *       200:
 *         description: "OK."
 *       400:
 *         description: "Missing or invalid fields."
 *       409:
 *         description: "The new terms do not start after the latest ones, or the person has left."
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 */
const setCompensation = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await PayService.setCompensation(req.user as RequestUser, req.params.id, resolveStoreScope(req), req.body) }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /hr/employees/{id}/earnings:
 *   get:
 *     operationId: getEmployeeEarnings
 *     summary: "What someone has earned, against what scheme, and what has been paid"
 *     description: "**Who can call this:** admin, hr (super_admin always allowed)."
 *     tags: ["HR - Pay & Incentives"]
 *     x-roles: [admin, hr]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
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
 *                               status: { type: string, enum: [pending, approved, paid] }
 *                         bonuses: { type: number, description: "Amount in INR" }
 *                         totalEarned: { type: number, description: "Amount in INR" }
 *                         paid: { type: number, description: "Amount in INR" }
 *                         due: { type: number, description: "Amount in INR" }
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 */
const getEmployeeEarnings = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await PayService.getEmployeeEarnings(req.params.id, resolveStoreScope(req), req.query) }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /hr/incentive-earnings:
 *   get:
 *     operationId: listIncentiveEarnings
 *     summary: "Incentives earned, waiting approval or paid"
 *     description: "**Who can call this:** admin, hr (super_admin always allowed)."
 *     tags: ["HR - Pay & Incentives"]
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
 *         schema: { type: string, enum: [pending, approved, paid] }
 *       - in: query
 *         name: employeeId
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: period
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
 *                               scheme: { type: string }
 *                               amount: { type: number, description: "Amount in INR" }
 *                               status: { type: string }
 *                               period: { type: string }
 *                         page: { type: integer }
 *                         limit: { type: integer }
 *                         total: { type: integer }
 *       403:
 *         description: Your role is not allowed to call this.
 */
const listIncentiveEarnings = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await PayService.listIncentiveEarnings(resolveStoreScope(req), req.query) }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /hr/incentive-earnings/{id}/approve:
 *   post:
 *     operationId: approveIncentiveEarning
 *     summary: "Approve an earned incentive for payment"
 *     description: "**Who can call this:** admin, hr (super_admin always allowed)."
 *     tags: ["HR - Pay & Incentives"]
 *     x-roles: [admin, hr]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: "OK."
 *       409:
 *         description: "The period has not ended, or the incentive was already approved."
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 */
const approveIncentiveEarning = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await PayService.approveIncentiveEarning(req.user as RequestUser, req.params.id, resolveStoreScope(req)) }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /hr/incentive-schemes:
 *   get:
 *     operationId: listIncentiveSchemes
 *     summary: "List incentive schemes"
 *     description: "**Who can call this:** admin, hr (super_admin always allowed)."
 *     tags: ["HR - Pay & Incentives"]
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
 *                         items:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               id: { type: string, format: uuid }
 *                               name: { type: string }
 *                               appliesTo: { type: string, enum: [staff, rider, both] }
 *                               metric: { type: string, enum: [jobs_completed, orders_processed, rating, attendance, distance] }
 *                               period: { type: string, enum: [daily, weekly, monthly] }
 *                               rules:
 *                                 type: array
 *                                 items:
 *                                   type: object
 *                                   required: [threshold, reward]
 *                                   properties:
 *                                     threshold: { type: number }
 *                                     reward: { type: number, description: "Amount in INR" }
 *                               isActive: { type: boolean }
 *                               createdAt: { type: string, format: date-time }
 *                               updatedAt: { type: string, format: date-time }
 *                         page: { type: integer }
 *                         limit: { type: integer }
 *                         total: { type: integer }
 *       403:
 *         description: Your role is not allowed to call this.
 */
const listIncentiveSchemes = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await PayService.listSchemes(req.query) }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /hr/incentive-schemes:
 *   post:
 *     operationId: createIncentiveScheme
 *     summary: "Create an incentive scheme"
 *     description: "**Who can call this:** admin, hr (super_admin always allowed)."
 *     tags: ["HR - Pay & Incentives"]
 *     x-roles: [admin, hr]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, appliesTo, metric]
 *             properties:
 *               name: { type: string }
 *               appliesTo: { type: string, enum: [staff, rider, both] }
 *               metric: { type: string, enum: [jobs_completed, orders_processed, rating, attendance, distance] }
 *               period: { type: string, enum: [daily, weekly, monthly] }
 *               rules:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required: [threshold, reward]
 *                   properties:
 *                     threshold: { type: number }
 *                     reward: { type: number, description: "Amount in INR" }
 *               isActive: { type: boolean }
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
 *                         name: { type: string }
 *                         appliesTo: { type: string, enum: [staff, rider, both] }
 *                         metric: { type: string, enum: [jobs_completed, orders_processed, rating, attendance, distance] }
 *                         period: { type: string, enum: [daily, weekly, monthly] }
 *                         rules:
 *                           type: array
 *                           items:
 *                             type: object
 *                             required: [threshold, reward]
 *                             properties:
 *                               threshold: { type: number }
 *                               reward: { type: number, description: "Amount in INR" }
 *                         isActive: { type: boolean }
 *                         createdAt: { type: string, format: date-time }
 *                         updatedAt: { type: string, format: date-time }
 *       400:
 *         description: "Missing or invalid fields."
 *       403:
 *         description: Your role is not allowed to call this.
 */
const createIncentiveScheme = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: created, result: await PayService.createScheme(req.body) }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /hr/incentive-schemes/{id}:
 *   get:
 *     operationId: getIncentiveScheme
 *     summary: "Get an incentive scheme"
 *     description: "**Who can call this:** admin, hr (super_admin always allowed)."
 *     tags: ["HR - Pay & Incentives"]
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
 *                         name: { type: string }
 *                         appliesTo: { type: string, enum: [staff, rider, both] }
 *                         metric: { type: string, enum: [jobs_completed, orders_processed, rating, attendance, distance] }
 *                         period: { type: string, enum: [daily, weekly, monthly] }
 *                         rules:
 *                           type: array
 *                           items:
 *                             type: object
 *                             required: [threshold, reward]
 *                             properties:
 *                               threshold: { type: number }
 *                               reward: { type: number, description: "Amount in INR" }
 *                         isActive: { type: boolean }
 *                         createdAt: { type: string, format: date-time }
 *                         updatedAt: { type: string, format: date-time }
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 */
const getIncentiveScheme = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await PayService.getScheme(req.params.id) }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /hr/incentive-schemes/{id}:
 *   patch:
 *     operationId: updateIncentiveScheme
 *     summary: "Update an incentive scheme"
 *     description: "**Who can call this:** admin, hr (super_admin always allowed)."
 *     tags: ["HR - Pay & Incentives"]
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
 *               name: { type: string }
 *               appliesTo: { type: string, enum: [staff, rider, both] }
 *               metric: { type: string, enum: [jobs_completed, orders_processed, rating, attendance, distance] }
 *               period: { type: string, enum: [daily, weekly, monthly] }
 *               rules:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required: [threshold, reward]
 *                   properties:
 *                     threshold: { type: number }
 *                     reward: { type: number, description: "Amount in INR" }
 *               isActive: { type: boolean }
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
 *                         appliesTo: { type: string, enum: [staff, rider, both] }
 *                         metric: { type: string, enum: [jobs_completed, orders_processed, rating, attendance, distance] }
 *                         period: { type: string, enum: [daily, weekly, monthly] }
 *                         rules:
 *                           type: array
 *                           items:
 *                             type: object
 *                             required: [threshold, reward]
 *                             properties:
 *                               threshold: { type: number }
 *                               reward: { type: number, description: "Amount in INR" }
 *                         isActive: { type: boolean }
 *                         createdAt: { type: string, format: date-time }
 *                         updatedAt: { type: string, format: date-time }
 *       400:
 *         description: "Missing or invalid fields."
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 */
const updateIncentiveScheme = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await PayService.updateScheme(req.params.id, req.body) }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /hr/incentive-schemes/{id}/assign:
 *   post:
 *     operationId: assignIncentiveScheme
 *     summary: "Put people on a scheme"
 *     description: "**Who can call this:** admin, hr (super_admin always allowed)."
 *     tags: ["HR - Pay & Incentives"]
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
 *             required: [employeeIds]
 *             properties:
 *               employeeIds: { type: array, items: { type: string, format: uuid } }
 *     responses:
 *       200:
 *         description: "OK."
 *       400:
 *         description: "Missing or invalid fields."
 *       409:
 *         description: "The scheme is switched off."
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 */
const assignIncentiveScheme = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await PayService.assignScheme(req.user as RequestUser, req.params.id, resolveStoreScope(req), req.body) }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /hr/payouts:
 *   post:
 *     operationId: recordPayout
 *     summary: "Record that a payment was made"
 *     description: "**Who can call this:** admin, hr (super_admin always allowed)."
 *     tags: ["HR - Pay & Incentives"]
 *     x-roles: [admin, hr]
 *     parameters:
 *       - in: header
 *         name: Idempotency-Key
 *         required: false
 *         schema: { type: string }
 *         description: "Optional. Repeating a request with the same key returns the first result."
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [employeeId, amount, type, period, paidOn]
 *             properties:
 *               employeeId: { type: string, format: uuid }
 *               amount: { type: number, description: "Amount in INR" }
 *               type: { type: string, enum: [salary, incentive, bonus, advance] }
 *               period: { type: string }
 *               paidOn: { type: string, format: date }
 *               reference: { type: string }
 *     responses:
 *       201:
 *         description: "Created."
 *       400:
 *         description: "Missing or invalid fields."
 *       409:
 *         description: "More than the approved incentives, or the Idempotency-Key was used for a different payout."
 *       403:
 *         description: Your role is not allowed to call this.
 */
const recordPayout = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: created, result: await PayService.recordPayout(req.user as RequestUser, resolveStoreScope(req), req.body, idempotencyKeyOf(req.header("idempotency-key"))) }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /hr/payouts:
 *   get:
 *     operationId: listPayouts
 *     summary: "Payments made"
 *     description: "**Who can call this:** admin, hr (super_admin always allowed)."
 *     tags: ["HR - Pay & Incentives"]
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
 *         name: type
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
 *                         items:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               id: { type: string, format: uuid }
 *                               employeeId: { type: string, format: uuid }
 *                               amount: { type: number, description: "Amount in INR" }
 *                               type: { type: string }
 *                               period: { type: string }
 *                               paidOn: { type: string, format: date }
 *                         page: { type: integer }
 *                         limit: { type: integer }
 *                         total: { type: integer }
 *       403:
 *         description: Your role is not allowed to call this.
 */
const listPayouts = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await PayService.listPayouts(resolveStoreScope(req), req.query) }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

export const HrPayController = {
  getCompensation,
  setCompensation,
  getEmployeeEarnings,
  listIncentiveEarnings,
  approveIncentiveEarning,
  listIncentiveSchemes,
  createIncentiveScheme,
  getIncentiveScheme,
  updateIncentiveScheme,
  assignIncentiveScheme,
  recordPayout,
  listPayouts,
};
