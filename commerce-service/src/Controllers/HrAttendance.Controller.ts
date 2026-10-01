import { Response } from "express";
import { handleErrorResponse, handleSuccessResponse } from "../../commons/Response/Response.js";
import { created, successCode } from "../../commons/Utils/StatusCode.js";
import { IdentifiedRequest, RequestUser } from "../Middleware/Identity.js";
import { resolveStoreScope } from "../Middleware/StoreScope.js";
import { AttendanceService } from "../Services/Attendance.Service.js";
import { RosterService } from "../Services/Roster.Service.js";

/**
 * @openapi
 * /hr/attendance:
 *   get:
 *     operationId: getAttendanceForDay
 *     summary: "Who is in, late, absent or on leave"
 *     description: "**Who can call this:** admin, hr, manager (super_admin always allowed)."
 *     tags: ["HR - Attendance"]
 *     x-roles: [admin, hr, manager]
 *     parameters:
 *       - in: query
 *         name: date
 *         required: true
 *         schema: { type: string, format: date }
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
 *                         date: { type: string, format: date }
 *                         people:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               employeeId: { type: string, format: uuid }
 *                               name: { type: string }
 *                               status: { type: string, enum: [present, late, absent, on_leave, off] }
 *                               clockIn: { type: string, format: date-time }
 *                               clockOut: { type: string, format: date-time }
 *                         page: { type: integer }
 *                         limit: { type: integer }
 *                         total: { type: integer }
 *       403:
 *         description: Your role is not allowed to call this.
 */
const getAttendanceForDay = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await AttendanceService.getForDay(resolveStoreScope(req), req.query) }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /hr/attendance/corrections:
 *   post:
 *     operationId: createAttendanceCorrection
 *     summary: "Correct a missed or wrong clock-in"
 *     description: "**Who can call this:** admin, hr (super_admin always allowed)."
 *     tags: ["HR - Attendance"]
 *     x-roles: [admin, hr]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [employeeId, date, reason]
 *             properties:
 *               employeeId: { type: string, format: uuid }
 *               date: { type: string, format: date }
 *               clockIn: { type: string, format: date-time }
 *               clockOut: { type: string, format: date-time }
 *               reason: { type: string }
 *     responses:
 *       201:
 *         description: "Created."
 *       400:
 *         description: "Missing or invalid fields."
 *       403:
 *         description: Your role is not allowed to call this.
 */
const createAttendanceCorrection = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: created, result: await AttendanceService.createCorrection(resolveStoreScope(req), req.user as RequestUser, req.body) }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /hr/attendance/corrections:
 *   get:
 *     operationId: listAttendanceCorrections
 *     summary: "Past attendance corrections"
 *     description: "**Who can call this:** admin, hr (super_admin always allowed)."
 *     tags: ["HR - Attendance"]
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
 *                               date: { type: string, format: date }
 *                               reason: { type: string }
 *                               correctedBy: { type: string }
 *                         page: { type: integer }
 *                         limit: { type: integer }
 *                         total: { type: integer }
 *       403:
 *         description: Your role is not allowed to call this.
 */
const listAttendanceCorrections = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await AttendanceService.listCorrections(resolveStoreScope(req), req.query) }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /hr/attendance/employees/{id}:
 *   get:
 *     operationId: getEmployeeAttendance
 *     summary: "One person's attendance record"
 *     description: "**Who can call this:** admin, hr, manager (super_admin always allowed)."
 *     tags: ["HR - Attendance"]
 *     x-roles: [admin, hr, manager]
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
 *                         days:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               date: { type: string, format: date }
 *                               status: { type: string, enum: [present, late, absent, on_leave, off] }
 *                               clockIn: { type: string, format: date-time }
 *                               clockOut: { type: string, format: date-time }
 *                         employeeId: { type: string, format: uuid }
 *                         month: { type: string, description: "YYYY-MM" }
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 */
const getEmployeeAttendance = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await AttendanceService.getEmployeeMonth(req.params.id, resolveStoreScope(req), req.query) }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /hr/attendance/summary:
 *   get:
 *     operationId: getAttendanceSummary
 *     summary: "Attendance over a period"
 *     description: "**Who can call this:** admin, hr, manager (super_admin always allowed)."
 *     tags: ["HR - Attendance"]
 *     x-roles: [admin, hr, manager]
 *     parameters:
 *       - in: query
 *         name: storeId
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: from
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: to
 *         schema: { type: string, format: date }
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
 *                         employees:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               employeeId: { type: string, format: uuid }
 *                               name: { type: string }
 *                               present: { type: integer }
 *                               late: { type: integer }
 *                               absent: { type: integer }
 *                               leave: { type: integer }
 *                               workingDays: { type: integer, description: "days on the books, holidays excluded" }
 *                               attendanceRatePct: { type: number, nullable: true }
 *                         from: { type: string, format: date }
 *                         to: { type: string, format: date }
 *                         page: { type: integer }
 *                         limit: { type: integer }
 *                         total: { type: integer }
 *       403:
 *         description: Your role is not allowed to call this.
 */
const getAttendanceSummary = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await AttendanceService.getSummary(resolveStoreScope(req), req.query) }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /hr/rosters:
 *   post:
 *     operationId: createRosterEntry
 *     summary: "Put someone on a shift"
 *     description: "**Who can call this:** admin, hr, manager (super_admin always allowed)."
 *     tags: ["HR - Attendance"]
 *     x-roles: [admin, hr, manager]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [employeeId, storeId, date, shiftStart, shiftEnd]
 *             properties:
 *               employeeId: { type: string, format: uuid }
 *               storeId: { type: string, format: uuid }
 *               date: { type: string, format: date }
 *               shiftStart: { type: string, description: "HH:MM" }
 *               shiftEnd: { type: string, description: "HH:MM" }
 *     responses:
 *       201:
 *         description: "Created."
 *       400:
 *         description: "Missing or invalid fields."
 *       409:
 *         description: "The person already has an overlapping shift that day."
 *       403:
 *         description: Your role is not allowed to call this.
 */
const createRosterEntry = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: created, result: await RosterService.create(resolveStoreScope(req), req.user as RequestUser, req.body) }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /hr/rosters:
 *   get:
 *     operationId: listRosterEntries
 *     summary: "The shift roster"
 *     description: "**Who can call this:** admin, hr, manager (super_admin always allowed)."
 *     tags: ["HR - Attendance"]
 *     x-roles: [admin, hr, manager]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, description: "1-based page number" }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, description: "page size, max 100" }
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
 *                               storeId: { type: string, format: uuid }
 *                               date: { type: string, format: date }
 *                               shiftStart: { type: string }
 *                               shiftEnd: { type: string }
 *                         page: { type: integer }
 *                         limit: { type: integer }
 *                         total: { type: integer }
 *       403:
 *         description: Your role is not allowed to call this.
 */
const listRosterEntries = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await RosterService.list(resolveStoreScope(req), req.query) }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /hr/rosters/coverage:
 *   get:
 *     operationId: getRosterCoverage
 *     summary: "Is each shift staffed as needed?"
 *     description: "**Who can call this:** admin, hr, manager (super_admin always allowed)."
 *     tags: ["HR - Attendance"]
 *     x-roles: [admin, hr, manager]
 *     parameters:
 *       - in: query
 *         name: storeId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: date
 *         required: true
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
 *                         shifts:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               start: { type: string }
 *                               end: { type: string }
 *                               rostered: { type: integer }
 *                               required: { type: integer }
 *                               gap: { type: integer }
 *       403:
 *         description: Your role is not allowed to call this.
 */
const getRosterCoverage = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await RosterService.coverage(resolveStoreScope(req), req.query) }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /hr/rosters/{id}:
 *   delete:
 *     operationId: deleteRosterEntry
 *     summary: "Take someone off a shift"
 *     description: "**Who can call this:** admin, hr, manager (super_admin always allowed)."
 *     tags: ["HR - Attendance"]
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
const deleteRosterEntry = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await RosterService.remove(req.params.id, resolveStoreScope(req)) }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

export const HrAttendanceController = {
  getAttendanceForDay,
  createAttendanceCorrection,
  listAttendanceCorrections,
  getEmployeeAttendance,
  getAttendanceSummary,
  createRosterEntry,
  listRosterEntries,
  getRosterCoverage,
  deleteRosterEntry,
};
