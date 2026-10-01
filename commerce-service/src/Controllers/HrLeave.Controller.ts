import { Response } from "express";
import { handleErrorResponse, handleSuccessResponse } from "../../commons/Response/Response.js";
import { created, successCode } from "../../commons/Utils/StatusCode.js";
import { IdentifiedRequest, RequestUser } from "../Middleware/Identity.js";
import { resolveStoreScope } from "../Middleware/StoreScope.js";
import { HolidayService } from "../Services/Holiday.Service.js";
import { LeaveService } from "../Services/Leave.Service.js";

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
 */
const listHolidays = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await HolidayService.list(req.user as RequestUser, req.query) }, res);
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
 *       409:
 *         description: "That holiday is already on the calendar."
 *       403:
 *         description: Your role is not allowed to call this.
 */
const createHoliday = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: created, result: await HolidayService.create(req.body) }, res);
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
 */
const deleteHoliday = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await HolidayService.remove(req.params.id) }, res);
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
 *                         year: { type: integer }
 *                         utilisationPct: { type: number }
 *                         page: { type: integer }
 *                         limit: { type: integer }
 *                         total: { type: integer }
 *       403:
 *         description: Your role is not allowed to call this.
 */
const listLeaveBalances = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await LeaveService.listBalances(resolveStoreScope(req), req.query) }, res);
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
 *                         month: { type: string, description: "YYYY-MM" }
 *                         page: { type: integer }
 *                         limit: { type: integer }
 *                         total: { type: integer }
 *       403:
 *         description: Your role is not allowed to call this.
 */
const getLeaveCalendar = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await LeaveService.calendar(resolveStoreScope(req), req.query) }, res);
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
 */
const getLeavePolicies = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await LeaveService.getPolicies() }, res);
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
 */
const setLeavePolicies = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await LeaveService.setPolicies(req.body) }, res);
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
 */
const listLeaveRequests = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await LeaveService.list(resolveStoreScope(req), req.query) }, res);
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
 */
const countPendingLeaveRequests = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await LeaveService.countPending(resolveStoreScope(req)) }, res);
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
 */
const getLeaveRequest = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await LeaveService.getById(req.params.id, resolveStoreScope(req)) }, res);
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
 *       409:
 *         description: "Already decided, or not enough balance left."
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 */
const approveLeaveRequest = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await LeaveService.approve(req.params.id, resolveStoreScope(req), req.user as RequestUser, req.body) }, res);
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
 *       409:
 *         description: "Already decided."
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 */
const rejectLeaveRequest = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await LeaveService.reject(req.params.id, resolveStoreScope(req), req.user as RequestUser, req.body) }, res);
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
