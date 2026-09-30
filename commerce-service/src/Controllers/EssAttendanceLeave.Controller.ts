// @generated-scaffold — contract scaffold from the API catalogue; handlers answer 501 until built.
// Once you implement a handler, delete the first line so regeneration can never overwrite your work.
import { Request, Response } from "express";
import { handleErrorResponse, handleNotImplementedResponse } from "../../commons/Response/Response.js";
import { requireFields } from "../../commons/Utils/Validation.js";

/**
 * @openapi
 * /hr/me/attendance:
 *   get:
 *     operationId: getMyAttendance
 *     summary: "My own attendance record for the month"
 *     description: "**Who can call this:** admin, hr, manager, staff, driver (super_admin always allowed)."
 *     tags: ["Employee Self-Service - Attendance & Leave"]
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
 *                         days:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               date: { type: string, format: date }
 *                               status: { type: string, enum: [present, late, absent, on_leave, off] }
 *                               clockIn: { type: string, format: date-time }
 *                               clockOut: { type: string, format: date-time }
 *       403:
 *         description: Your role is not allowed to call this.
 *       501:
 *         description: "Scaffolded per API contract — implementation pending."
 */
const getMyAttendance = async (_req: Request, res: Response) => {
  try {
    return handleNotImplementedResponse(res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /hr/me/attendance/clock-in:
 *   post:
 *     operationId: clockIn
 *     summary: "Clock in"
 *     description: "**Who can call this:** admin, hr, manager, staff, driver (super_admin always allowed)."
 *     tags: ["Employee Self-Service - Attendance & Leave"]
 *     x-roles: [admin, hr, manager, staff, driver]
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               storeId: { type: string, format: uuid }
 *               latitude: { type: number }
 *               longitude: { type: number }
 *     responses:
 *       200:
 *         description: "OK."
 *       400:
 *         description: "Missing or invalid fields."
 *       403:
 *         description: Your role is not allowed to call this.
 *       409:
 *         description: "Already clocked in."
 *       501:
 *         description: "Scaffolded per API contract — implementation pending."
 */
const clockIn = async (_req: Request, res: Response) => {
  try {
    return handleNotImplementedResponse(res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /hr/me/attendance/clock-out:
 *   post:
 *     operationId: clockOut
 *     summary: "Clock out"
 *     description: "**Who can call this:** admin, hr, manager, staff, driver (super_admin always allowed)."
 *     tags: ["Employee Self-Service - Attendance & Leave"]
 *     x-roles: [admin, hr, manager, staff, driver]
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               latitude: { type: number }
 *               longitude: { type: number }
 *     responses:
 *       200:
 *         description: "OK."
 *       400:
 *         description: "Missing or invalid fields."
 *       403:
 *         description: Your role is not allowed to call this.
 *       409:
 *         description: "Not clocked in."
 *       501:
 *         description: "Scaffolded per API contract — implementation pending."
 */
const clockOut = async (_req: Request, res: Response) => {
  try {
    return handleNotImplementedResponse(res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /hr/me/leave-balance:
 *   get:
 *     operationId: getMyLeaveBalance
 *     summary: "My remaining leave"
 *     description: "**Who can call this:** admin, hr, manager, staff, driver (super_admin always allowed)."
 *     tags: ["Employee Self-Service - Attendance & Leave"]
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
 *                         balances:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               type: { type: string, enum: [casual, sick, earned, unpaid, other] }
 *                               entitled: { type: number }
 *                               taken: { type: number }
 *                               remaining: { type: number }
 *       403:
 *         description: Your role is not allowed to call this.
 *       501:
 *         description: "Scaffolded per API contract — implementation pending."
 */
const getMyLeaveBalance = async (_req: Request, res: Response) => {
  try {
    return handleNotImplementedResponse(res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /hr/me/leave-requests:
 *   post:
 *     operationId: requestLeave
 *     summary: "Ask for leave"
 *     description: "**Who can call this:** admin, hr, manager, staff, driver (super_admin always allowed)."
 *     tags: ["Employee Self-Service - Attendance & Leave"]
 *     x-roles: [admin, hr, manager, staff, driver]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [type, from, to]
 *             properties:
 *               type: { type: string, enum: [casual, sick, earned, unpaid, other] }
 *               from: { type: string, format: date }
 *               to: { type: string, format: date }
 *               halfDay: { type: boolean }
 *               reason: { type: string }
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
const requestLeave = async (req: Request, res: Response) => {
  try {
    requireFields(req.body, ["type", "from", "to"]);
    return handleNotImplementedResponse(res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /hr/me/leave-requests:
 *   get:
 *     operationId: listMyLeaveRequests
 *     summary: "My leave requests and where each has got to"
 *     description: "**Who can call this:** admin, hr, manager, staff, driver (super_admin always allowed)."
 *     tags: ["Employee Self-Service - Attendance & Leave"]
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
 *         schema: { type: string, enum: [pending, approved, rejected, withdrawn] }
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
const listMyLeaveRequests = async (_req: Request, res: Response) => {
  try {
    return handleNotImplementedResponse(res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /hr/me/leave-requests/{id}/withdraw:
 *   post:
 *     operationId: withdrawMyLeaveRequest
 *     summary: "Withdraw a request that has not been decided"
 *     description: "**Who can call this:** admin, hr, manager, staff, driver (super_admin always allowed)."
 *     tags: ["Employee Self-Service - Attendance & Leave"]
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
 *       501:
 *         description: "Scaffolded per API contract — implementation pending."
 */
const withdrawMyLeaveRequest = async (_req: Request, res: Response) => {
  try {
    return handleNotImplementedResponse(res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

export const EssAttendanceLeaveController = {
  getMyAttendance,
  clockIn,
  clockOut,
  getMyLeaveBalance,
  requestLeave,
  listMyLeaveRequests,
  withdrawMyLeaveRequest,
};
