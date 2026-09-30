// @generated-scaffold — contract scaffold from the API catalogue; handlers answer 501 until built.
// Once you implement a handler, delete the first line so regeneration can never overwrite your work.
import { Request, Response } from "express";
import { handleErrorResponse, handleNotImplementedResponse } from "../../commons/Response/Response.js";
import { requireFields } from "../../commons/Utils/Validation.js";

/**
 * @openapi
 * /hr/holidays:
 *   get:
 *     operationId: listHolidays
 *     summary: "The holiday calendar, visible to everyone so nobody plans around a closed day"
 *     description: "**Who can call this:** admin, hr, manager, staff, driver (super_admin always allowed)."
 *     tags: ["HR - Leave & Holidays"]
 *     x-roles: [admin, hr, manager, staff, driver]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, description: "1-based page number" }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, description: "page size, max 100" }
 *       - in: query
 *         name: year
 *         schema: { type: integer }
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
 *                         items:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               id: { type: string, format: uuid }
 *                               date: { type: string, format: date }
 *                               name: { type: string }
 *                               type: { type: string, enum: [public, company, store] }
 *                               storeIds: { type: array, items: { type: string, format: uuid } }
 *                         page: { type: integer }
 *                         limit: { type: integer }
 *                         total: { type: integer }
 *       403:
 *         description: Your role is not allowed to call this.
 *       501:
 *         description: "Scaffolded per API contract — implementation pending."
 */
const listHolidays = async (_req: Request, res: Response) => {
  try {
    return handleNotImplementedResponse(res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /hr/holidays:
 *   post:
 *     operationId: createHoliday
 *     summary: "Add a holiday"
 *     description: "**Who can call this:** admin, hr (super_admin always allowed)."
 *     tags: ["HR - Leave & Holidays"]
 *     x-roles: [admin, hr]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [date, name]
 *             properties:
 *               date: { type: string, format: date }
 *               name: { type: string }
 *               type: { type: string, enum: [public, company, store] }
 *               storeIds: { type: array, items: { type: string, format: uuid } }
 *     responses:
 *       201:
 *         description: "Created."
 *       400:
 *         description: "Missing or invalid fields."
 *       403:
 *         description: Your role is not allowed to call this.
 *       501:
 *         description: "Scaffolded per API contract — implementation pending."
 */
const createHoliday = async (req: Request, res: Response) => {
  try {
    requireFields(req.body, ["date", "name"]);
    return handleNotImplementedResponse(res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /hr/holidays/{id}:
 *   delete:
 *     operationId: deleteHoliday
 *     summary: "Remove a holiday"
 *     description: "**Who can call this:** admin, hr (super_admin always allowed)."
 *     tags: ["HR - Leave & Holidays"]
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
 *       501:
 *         description: "Scaffolded per API contract — implementation pending."
 */
const deleteHoliday = async (_req: Request, res: Response) => {
  try {
    return handleNotImplementedResponse(res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /hr/leave/balances:
 *   get:
 *     operationId: listLeaveBalances
 *     summary: "Remaining leave balances"
 *     description: "**Who can call this:** admin, hr (super_admin always allowed)."
 *     tags: ["HR - Leave & Holidays"]
 *     x-roles: [admin, hr]
 *     parameters:
 *       - in: query
 *         name: employeeId
 *         schema: { type: string, format: uuid }
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
 *                         balances:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               employeeId: { type: string, format: uuid }
 *                               name: { type: string }
 *                               type: { type: string, enum: [casual, sick, earned, unpaid, other] }
 *                               entitled: { type: number }
 *                               taken: { type: number }
 *                               remaining: { type: number }
 *       403:
 *         description: Your role is not allowed to call this.
 *       501:
 *         description: "Scaffolded per API contract — implementation pending."
 */
const listLeaveBalances = async (_req: Request, res: Response) => {
  try {
    return handleNotImplementedResponse(res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /hr/leave/calendar:
 *   get:
 *     operationId: getLeaveCalendar
 *     summary: "Who is off, when"
 *     description: "**Who can call this:** admin, hr, manager (super_admin always allowed)."
 *     tags: ["HR - Leave & Holidays"]
 *     x-roles: [admin, hr, manager]
 *     parameters:
 *       - in: query
 *         name: month
 *         required: true
 *         schema: { type: string, description: "YYYY-MM" }
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
 *                         entries:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               employeeId: { type: string, format: uuid }
 *                               name: { type: string }
 *                               from: { type: string, format: date }
 *                               to: { type: string, format: date }
 *                               type: { type: string, enum: [casual, sick, earned, unpaid, other] }
 *       403:
 *         description: Your role is not allowed to call this.
 *       501:
 *         description: "Scaffolded per API contract — implementation pending."
 */
const getLeaveCalendar = async (_req: Request, res: Response) => {
  try {
    return handleNotImplementedResponse(res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /hr/leave/policies:
 *   get:
 *     operationId: getLeavePolicies
 *     summary: "Annual leave entitlements"
 *     description: "**Who can call this:** admin, hr (super_admin always allowed)."
 *     tags: ["HR - Leave & Holidays"]
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
 *                         policies:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               type: { type: string, enum: [casual, sick, earned, unpaid, other] }
 *                               annualDays: { type: number }
 *                               carryForward: { type: boolean }
 *       403:
 *         description: Your role is not allowed to call this.
 *       501:
 *         description: "Scaffolded per API contract — implementation pending."
 */
const getLeavePolicies = async (_req: Request, res: Response) => {
  try {
    return handleNotImplementedResponse(res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /hr/leave/policies:
 *   put:
 *     operationId: setLeavePolicies
 *     summary: "Set annual leave entitlements"
 *     description: "**Who can call this:** admin, hr (super_admin always allowed)."
 *     tags: ["HR - Leave & Holidays"]
 *     x-roles: [admin, hr]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [policies]
 *             properties:
 *               policies:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required: [type, annualDays]
 *                   properties:
 *                     type: { type: string, enum: [casual, sick, earned, unpaid, other] }
 *                     annualDays: { type: number }
 *                     carryForward: { type: boolean }
 *     responses:
 *       200:
 *         description: "OK."
 *       400:
 *         description: "Missing or invalid fields."
 *       403:
 *         description: Your role is not allowed to call this.
 *       501:
 *         description: "Scaffolded per API contract — implementation pending."
 */
const setLeavePolicies = async (req: Request, res: Response) => {
  try {
    requireFields(req.body, ["policies"]);
    return handleNotImplementedResponse(res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /hr/leave/requests:
 *   get:
 *     operationId: listLeaveRequests
 *     summary: "Leave requests awaiting or past a decision"
 *     description: "**Who can call this:** admin, hr, manager (super_admin always allowed)."
 *     tags: ["HR - Leave & Holidays"]
 *     x-roles: [admin, hr, manager]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, description: "1-based page number" }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, description: "page size, max 100" }
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [pending, approved, rejected, withdrawn] }
 *       - in: query
 *         name: employeeId
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: storeId
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
 *                               employeeName: { type: string }
 *                               type: { type: string, enum: [casual, sick, earned, unpaid, other] }
 *                               from: { type: string, format: date }
 *                               to: { type: string, format: date }
 *                               halfDay: { type: boolean }
 *                               status: { type: string, enum: [pending, approved, rejected, withdrawn] }
 *                               reason: { type: string }
 *                               decidedBy: { type: string }
 *                               decidedAt: { type: string, format: date-time }
 *                         page: { type: integer }
 *                         limit: { type: integer }
 *                         total: { type: integer }
 *       403:
 *         description: Your role is not allowed to call this.
 *       501:
 *         description: "Scaffolded per API contract — implementation pending."
 */
const listLeaveRequests = async (_req: Request, res: Response) => {
  try {
    return handleNotImplementedResponse(res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /hr/leave/requests/pending-count:
 *   get:
 *     operationId: countPendingLeaveRequests
 *     summary: "How many requests are waiting for a decision"
 *     description: "**Who can call this:** admin, hr, manager (super_admin always allowed)."
 *     tags: ["HR - Leave & Holidays"]
 *     x-roles: [admin, hr, manager]
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
 *                         pending: { type: integer }
 *       403:
 *         description: Your role is not allowed to call this.
 *       501:
 *         description: "Scaffolded per API contract — implementation pending."
 */
const countPendingLeaveRequests = async (_req: Request, res: Response) => {
  try {
    return handleNotImplementedResponse(res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /hr/leave/requests/{id}:
 *   get:
 *     operationId: getLeaveRequest
 *     summary: "One leave request"
 *     description: "**Who can call this:** admin, hr, manager (super_admin always allowed)."
 *     tags: ["HR - Leave & Holidays"]
 *     x-roles: [admin, hr, manager]
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
 *                         employeeName: { type: string }
 *                         type: { type: string, enum: [casual, sick, earned, unpaid, other] }
 *                         from: { type: string, format: date }
 *                         to: { type: string, format: date }
 *                         halfDay: { type: boolean }
 *                         status: { type: string, enum: [pending, approved, rejected, withdrawn] }
 *                         reason: { type: string }
 *                         decidedBy: { type: string }
 *                         decidedAt: { type: string, format: date-time }
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 *       501:
 *         description: "Scaffolded per API contract — implementation pending."
 */
const getLeaveRequest = async (_req: Request, res: Response) => {
  try {
    return handleNotImplementedResponse(res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /hr/leave/requests/{id}/approve:
 *   post:
 *     operationId: approveLeaveRequest
 *     summary: "Approve a leave request"
 *     description: "**Who can call this:** admin, hr, manager (super_admin always allowed)."
 *     tags: ["HR - Leave & Holidays"]
 *     x-roles: [admin, hr, manager]
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
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 *       501:
 *         description: "Scaffolded per API contract — implementation pending."
 */
const approveLeaveRequest = async (_req: Request, res: Response) => {
  try {
    return handleNotImplementedResponse(res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /hr/leave/requests/{id}/reject:
 *   post:
 *     operationId: rejectLeaveRequest
 *     summary: "Decline a leave request"
 *     description: "**Who can call this:** admin, hr, manager (super_admin always allowed)."
 *     tags: ["HR - Leave & Holidays"]
 *     x-roles: [admin, hr, manager]
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
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 *       501:
 *         description: "Scaffolded per API contract — implementation pending."
 */
const rejectLeaveRequest = async (req: Request, res: Response) => {
  try {
    requireFields(req.body, ["reason"]);
    return handleNotImplementedResponse(res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

export const HrLeaveController = {
  listHolidays,
  createHoliday,
  deleteHoliday,
  listLeaveBalances,
  getLeaveCalendar,
  getLeavePolicies,
  setLeavePolicies,
  listLeaveRequests,
  countPendingLeaveRequests,
  getLeaveRequest,
  approveLeaveRequest,
  rejectLeaveRequest,
};
