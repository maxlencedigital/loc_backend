import { Request, Response } from "express";
import { handleErrorResponse, handleSuccessResponse } from "../../commons/Response/Response.js";
import { successCode } from "../../commons/Utils/StatusCode.js";
import { MachinesService } from "../Services/Machines.Service.js";

/**
 * @openapi
 * /internal/machines:
 *   post:
 *     operationId: internalRegisterMachine
 *     summary: "Register a floor machine (service to service)"
 *     description: "Internal. Idempotent on store and code: registering the same machine again refreshes its name, type, capacity and cycle time and never changes its state."
 *     tags: ["Internal - Store floor"]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [storeId, code, name, type, capacityKg]
 *             properties:
 *               storeId: { type: string, format: uuid }
 *               code: { type: string }
 *               name: { type: string }
 *               type: { type: string, enum: [washer, dryer, press, iron, other] }
 *               capacityKg: { type: number }
 *               cycleMinutes: { type: integer, description: "typical cycle, default 45" }
 *     responses:
 *       200:
 *         description: "The machine."
 *       400:
 *         description: "Invalid fields."
 *       404:
 *         description: "Store not found."
 */
const registerMachine = async (req: Request, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await MachinesService.registerMachine(req.body) }, res, "Machine registered.");
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /internal/machines/state:
 *   post:
 *     operationId: internalSetMachineState
 *     summary: "Take a machine into maintenance, or return it after repair (service to service)"
 *     description: "Internal. Maintenance drops a reservation; a running batch keeps its machine until it is completed. Returning a machine to idle also resolves its open faults."
 *     tags: ["Internal - Store floor"]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [machineId, state]
 *             properties:
 *               machineId: { type: string, format: uuid }
 *               state: { type: string, enum: [idle, maintenance] }
 *     responses:
 *       200:
 *         description: "The machine."
 *       400:
 *         description: "Invalid fields."
 *       404:
 *         description: "Machine not found."
 */
const setMachineState = async (req: Request, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await MachinesService.setMachineState(req.body) }, res, "Machine updated.");
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /internal/machines/faults:
 *   get:
 *     operationId: internalListOpenMachineFaults
 *     summary: "Open machine faults, for the equipment register (service to service)"
 *     description: "Internal. Newest first, paged."
 *     tags: ["Internal - Store floor"]
 *     parameters:
 *       - in: query
 *         name: storeId
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: page
 *         schema: { type: integer }
 *       - in: query
 *         name: limit
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: "A page of open faults."
 */
const listOpenFaults = async (req: Request, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await MachinesService.listOpenFaults(req.query) }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

export const StoreFloorInternalController = { registerMachine, setMachineState, listOpenFaults };
