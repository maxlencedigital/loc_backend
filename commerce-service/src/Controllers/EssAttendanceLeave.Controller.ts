import { Response } from "express";
import { handleErrorResponse, handleSuccessResponse } from "../../commons/Response/Response.js";
import { created, successCode } from "../../commons/Utils/StatusCode.js";
import { IdentifiedRequest, RequestUser } from "../Middleware/Identity.js";
import { EssService } from "../Services/Ess.Service.js";

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
 *       404:
 *         description: "No employee record is linked to your login, or the record asked for is not yours."
 */
const getMyAttendance = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await EssService.getMyAttendance((req.user as RequestUser).id, req.query) }, res);
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
 *       404:
 *         description: "No employee record is linked to your login, or the record asked for is not yours."
 *       409:
 *         description: "Already clocked in."
 */
const clockIn = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await EssService.clockIn((req.user as RequestUser).id, req.body) }, res);
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
 *       404:
 *         description: "No employee record is linked to your login, or the record asked for is not yours."
 *       409:
 *         description: "Not clocked in."
 */
const clockOut = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await EssService.clockOut((req.user as RequestUser).id, req.body) }, res);
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
 *       404:
 *         description: "No employee record is linked to your login, or the record asked for is not yours."
 */
const getMyLeaveBalance = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await EssService.getMyLeaveBalance((req.user as RequestUser).id) }, res);
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
 *     parameters:
 *       - in: header
 *         name: Idempotency-Key
 *         description: "Optional, 8 to 80 characters. A retry with the same key returns the first record (200) instead of creating another."
 *         schema: { type: string }
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
 *       404:
 *         description: "No employee record is linked to your login, or the record asked for is not yours."
 */
const requestLeave = async (req: IdentifiedRequest, res: Response) => {
  try {
    const { replayed, result } = await EssService.requestLeave((req.user as RequestUser).id, req.body, req.header("idempotency-key"));
    return handleSuccessResponse({ statusCode: replayed ? successCode : created, result }, res);
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
 *       404:
 *         description: "No employee record is linked to your login, or the record asked for is not yours."
 */
const listMyLeaveRequests = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await EssService.listMyLeaveRequests((req.user as RequestUser).id, req.query) }, res);
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
 */
const withdrawMyLeaveRequest = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await EssService.withdrawMyLeaveRequest((req.user as RequestUser).id, req.params.id) }, res);
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
