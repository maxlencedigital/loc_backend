import { Response } from "express";
import { handleErrorResponse, handleSuccessResponse } from "../../commons/Response/Response.js";
import { created, successCode } from "../../commons/Utils/StatusCode.js";
import { IdentifiedRequest } from "../Middleware/Identity.js";
import { resolveStoreScope } from "../Middleware/StoreScope.js";
import { StoreDayOpsService } from "../Services/StoreDayOps.Service.js";

/**
 * @openapi
 * /stores/{id}/performance:
 *   get:
 *     operationId: getStorePerformance
 *     summary: "How this store and its team are doing"
 *     description: "**Who can call this:** admin, manager (super_admin always allowed)."
 *     tags: ["Store - Day Operations"]
 *     x-roles: [admin, manager]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
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
 *                         ordersProcessed: { type: integer }
 *                         onTimePct: { type: number }
 *                         qualityFailPct: { type: number }
 *                         complaintsOpen: { type: integer }
 *                         staff:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               employeeId: { type: string, format: uuid }
 *                               name: { type: string }
 *                               ordersHandled: { type: integer }
 *                               qualityScore: { type: number }
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 */
const getStorePerformance = async (req: IdentifiedRequest, res: Response) => {
  try {
    const scope = resolveStoreScope(req);
    const result = await StoreDayOpsService.getStorePerformance(scope, req.params.id, req.query);
    return handleSuccessResponse({ statusCode: successCode, result }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /stores/{id}/resource-readings:
 *   post:
 *     operationId: recordResourceReading
 *     summary: "Record the day's water, electricity and detergent use"
 *     description: "**Who can call this:** admin, manager, staff (super_admin always allowed). Feeds cost-per-order analytics."
 *     tags: ["Store - Day Operations"]
 *     x-roles: [admin, manager, staff]
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
 *             required: [date]
 *             properties:
 *               date: { type: string, format: date }
 *               waterLitres: { type: number }
 *               electricityKwh: { type: number }
 *               detergentKg: { type: number }
 *               notes: { type: string }
 *     responses:
 *       201:
 *         description: "Created."
 *       400:
 *         description: "Missing or invalid fields."
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 */
const recordResourceReading = async (req: IdentifiedRequest, res: Response) => {
  try {
    const scope = resolveStoreScope(req);
    const user = req.user as NonNullable<typeof req.user>;
    const result = await StoreDayOpsService.recordResourceReading(scope, user, req.params.id, req.body);
    return handleSuccessResponse({ statusCode: created, result }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /stores/{id}/resource-readings:
 *   get:
 *     operationId: listResourceReadings
 *     summary: "Past resource readings"
 *     description: "**Who can call this:** admin, manager, staff (super_admin always allowed)."
 *     tags: ["Store - Day Operations"]
 *     x-roles: [admin, manager, staff]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
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
 *                               waterLitres: { type: number }
 *                               electricityKwh: { type: number }
 *                               detergentKg: { type: number }
 *                         page: { type: integer }
 *                         limit: { type: integer }
 *                         total: { type: integer }
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 */
const listResourceReadings = async (req: IdentifiedRequest, res: Response) => {
  try {
    const scope = resolveStoreScope(req);
    const result = await StoreDayOpsService.listResourceReadings(scope, req.params.id, req.query);
    return handleSuccessResponse({ statusCode: successCode, result }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /stores/{id}/staff:
 *   get:
 *     operationId: listStoreStaff
 *     summary: "Staff assigned to this store and who is on shift"
 *     description: "**Who can call this:** admin, manager (super_admin always allowed)."
 *     tags: ["Store - Day Operations"]
 *     x-roles: [admin, manager]
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
 *                         staff:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               employeeId: { type: string, format: uuid }
 *                               name: { type: string }
 *                               role: { type: string }
 *                               onShift: { type: boolean }
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 */
const listStoreStaff = async (req: IdentifiedRequest, res: Response) => {
  try {
    const scope = resolveStoreScope(req);
    const result = await StoreDayOpsService.listStoreStaff(scope, req.params.id);
    return handleSuccessResponse({ statusCode: successCode, result }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /stores/{id}/tasks/today:
 *   get:
 *     operationId: getStoreTasksToday
 *     summary: "Today's checks, servicing and alerts for this store"
 *     description: "**Who can call this:** admin, manager, staff (super_admin always allowed). Routine servicing due today appears here as a task instead of being remembered."
 *     tags: ["Store - Day Operations"]
 *     x-roles: [admin, manager, staff]
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
 *                         machineChecksDue:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               machineId: { type: string, format: uuid }
 *                               name: { type: string }
 *                         servicingDue:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               equipmentId: { type: string, format: uuid }
 *                               name: { type: string }
 *                               task: { type: string }
 *                         lowStock:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               itemId: { type: string, format: uuid }
 *                               name: { type: string }
 *                               level: { type: string }
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 */
const getStoreTasksToday = async (req: IdentifiedRequest, res: Response) => {
  try {
    const scope = resolveStoreScope(req);
    const result = await StoreDayOpsService.getStoreTasksToday(scope, req.params.id);
    return handleSuccessResponse({ statusCode: successCode, result }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

export const StoreDayOpsController = {
  getStorePerformance,
  recordResourceReading,
  listResourceReadings,
  listStoreStaff,
  getStoreTasksToday,
};
