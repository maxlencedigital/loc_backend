import { Response } from "express";
import { handleErrorResponse, handleSuccessResponse } from "../../commons/Response/Response.js";
import { created, successCode } from "../../commons/Utils/StatusCode.js";
import { IdentifiedRequest, RequestUser } from "../Middleware/Identity.js";
import { resolveStoreScope } from "../Middleware/StoreScope.js";
import { MachinesService } from "../Services/Machines.Service.js";

/**
 * @openapi
 * /machines:
 *   get:
 *     operationId: listMachines
 *     summary: "Machines and what each is doing"
 *     description: "**Who can call this:** admin, manager, staff (super_admin always allowed)."
 *     tags: ["Store - Machines & Daily Checks"]
 *     x-roles: [admin, manager, staff]
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
 *         name: status
 *         schema: { type: string, enum: [free, running, finishing, reserved, out_of_service] }
 *       - in: query
 *         name: type
 *         schema: { type: string, enum: [washer, dryer, press, iron, other] }
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
 *                               storeId: { type: string, format: uuid }
 *                               name: { type: string }
 *                               type: { type: string, enum: [washer, dryer, press, iron, other] }
 *                               capacityKg: { type: number }
 *                               status: { type: string, enum: [free, running, finishing, reserved, out_of_service] }
 *                               currentBatchId: { type: string, format: uuid }
 *                               freeAt: { type: string, format: date-time }
 *                         page: { type: integer }
 *                         limit: { type: integer }
 *                         total: { type: integer }
 *       403:
 *         description: Your role is not allowed to call this.
 */
const listMachines = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await MachinesService.listMachines(resolveStoreScope(req), req.query);
    return handleSuccessResponse({ statusCode: successCode, result }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /machines/available:
 *   get:
 *     operationId: listAvailableMachines
 *     summary: "Machines genuinely free for a new batch"
 *     description: "**Who can call this:** admin, manager, staff (super_admin always allowed)."
 *     tags: ["Store - Machines & Daily Checks"]
 *     x-roles: [admin, manager, staff]
 *     parameters:
 *       - in: query
 *         name: storeId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: type
 *         schema: { type: string, enum: [washer, dryer, press, iron, other] }
 *       - in: query
 *         name: at
 *         schema: { type: string, format: date-time }
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
 *                         machines:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               id: { type: string, format: uuid }
 *                               name: { type: string }
 *                               type: { type: string, enum: [washer, dryer, press, iron, other] }
 *                               freeAt: { type: string, format: date-time }
 *       403:
 *         description: Your role is not allowed to call this.
 */
const listAvailableMachines = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await MachinesService.listAvailableMachines(resolveStoreScope(req), req.query);
    return handleSuccessResponse({ statusCode: successCode, result }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /machines/{id}:
 *   get:
 *     operationId: getMachine
 *     summary: "Get one machine"
 *     description: "**Who can call this:** admin, manager, staff (super_admin always allowed)."
 *     tags: ["Store - Machines & Daily Checks"]
 *     x-roles: [admin, manager, staff]
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
const getMachine = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await MachinesService.getMachine(req.params.id as string, resolveStoreScope(req));
    return handleSuccessResponse({ statusCode: successCode, result }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /machines/{id}/daily-checks:
 *   post:
 *     operationId: recordMachineDailyCheck
 *     summary: "Record today's check on a machine"
 *     description: "**Who can call this:** admin, manager, staff (super_admin always allowed)."
 *     tags: ["Store - Machines & Daily Checks"]
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
 *             required: [status]
 *             properties:
 *               status: { type: string, enum: [ok, needs_attention] }
 *               checklist:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required: [item, ok]
 *                   properties:
 *                     item: { type: string }
 *                     ok: { type: boolean }
 *                     note: { type: string }
 *               note: { type: string }
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
const recordMachineDailyCheck = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await MachinesService.recordMachineDailyCheck(req.params.id as string, resolveStoreScope(req), req.user as RequestUser, req.body);
    return handleSuccessResponse({ statusCode: created, result }, res, "Check recorded.");
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /machines/{id}/daily-checks:
 *   get:
 *     operationId: listMachineDailyChecks
 *     summary: "Past daily checks for a machine"
 *     description: "**Who can call this:** admin, manager, staff (super_admin always allowed)."
 *     tags: ["Store - Machines & Daily Checks"]
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
 *                               status: { type: string }
 *                               checkedBy: { type: string }
 *                               note: { type: string }
 *                         page: { type: integer }
 *                         limit: { type: integer }
 *                         total: { type: integer }
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 */
const listMachineDailyChecks = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await MachinesService.listMachineDailyChecks(req.params.id as string, resolveStoreScope(req), req.query);
    return handleSuccessResponse({ statusCode: successCode, result }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /machines/{id}/faults:
 *   post:
 *     operationId: reportMachineFault
 *     summary: "Report that a machine is not running right"
 *     description: "**Who can call this:** admin, manager, staff (super_admin always allowed). Raises a repair on the equipment register for HR & Operations."
 *     tags: ["Store - Machines & Daily Checks"]
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
 *             required: [description]
 *             properties:
 *               description: { type: string }
 *               severity: { type: string, enum: [low, medium, high, stopped] }
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
const reportMachineFault = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await MachinesService.reportMachineFault(req.params.id as string, resolveStoreScope(req), req.user as RequestUser, req.body);
    return handleSuccessResponse({ statusCode: created, result }, res, "Fault reported.");
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /machines/{id}/release:
 *   post:
 *     operationId: releaseMachine
 *     summary: "Release a reservation"
 *     description: "**Who can call this:** admin, manager, staff (super_admin always allowed)."
 *     tags: ["Store - Machines & Daily Checks"]
 *     x-roles: [admin, manager, staff]
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
const releaseMachine = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await MachinesService.releaseMachine(req.params.id as string, resolveStoreScope(req));
    return handleSuccessResponse({ statusCode: successCode, result }, res, "Machine released.");
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /machines/{id}/reserve:
 *   post:
 *     operationId: reserveMachine
 *     summary: "Reserve a machine for a batch"
 *     description: "**Who can call this:** admin, manager, staff (super_admin always allowed)."
 *     tags: ["Store - Machines & Daily Checks"]
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
 *             required: [batchId]
 *             properties:
 *               batchId: { type: string, format: uuid }
 *               from: { type: string, format: date-time }
 *               until: { type: string, format: date-time }
 *     responses:
 *       200:
 *         description: "OK."
 *       400:
 *         description: "Missing or invalid fields."
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 *       409:
 *         description: "The machine is already running or reserved."
 */
const reserveMachine = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await MachinesService.reserveMachine(req.params.id as string, resolveStoreScope(req), req.body);
    return handleSuccessResponse({ statusCode: successCode, result }, res, "Machine reserved.");
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

export const StoreMachinesController = {
  listMachines,
  listAvailableMachines,
  getMachine,
  recordMachineDailyCheck,
  listMachineDailyChecks,
  reportMachineFault,
  releaseMachine,
  reserveMachine,
};
