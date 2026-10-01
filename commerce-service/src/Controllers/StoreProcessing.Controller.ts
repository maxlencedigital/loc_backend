import { Response } from "express";
import { handleErrorResponse, handleSuccessResponse } from "../../commons/Response/Response.js";
import { created, successCode } from "../../commons/Utils/StatusCode.js";
import { IdentifiedRequest, RequestUser } from "../Middleware/Identity.js";
import { resolveStoreScope } from "../Middleware/StoreScope.js";
import { ProcessingService } from "../Services/Processing.Service.js";

/**
 * @openapi
 * /batches:
 *   post:
 *     operationId: createBatch
 *     summary: "Group order items into a batch"
 *     description: "**Who can call this:** admin, manager, staff (super_admin always allowed)."
 *     tags: ["Store - Processing & Batches"]
 *     x-roles: [admin, manager, staff]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [storeId, serviceId, orderItemIds]
 *             properties:
 *               storeId: { type: string, format: uuid }
 *               serviceId: { type: string, format: uuid }
 *               orderItemIds: { type: array, items: { type: string, format: uuid } }
 *               machineId: { type: string, format: uuid }
 *               dueAt: { type: string, format: date-time }
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
 *                         status: { type: string, enum: [planned, in_machine, finished, cancelled] }
 *       400:
 *         description: "Missing or invalid fields."
 *       403:
 *         description: Your role is not allowed to call this.
 */
const createBatch = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await ProcessingService.createBatch(resolveStoreScope(req), req.user as RequestUser, req.body);
    return handleSuccessResponse({ statusCode: created, result }, res, "Batch created.");
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /batches:
 *   get:
 *     operationId: listBatches
 *     summary: "List batches"
 *     description: "**Who can call this:** admin, manager, staff (super_admin always allowed)."
 *     tags: ["Store - Processing & Batches"]
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
 *         schema: { type: string, enum: [planned, in_machine, finished, cancelled] }
 *       - in: query
 *         name: serviceId
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: dueBefore
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
 *                         items:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               id: { type: string, format: uuid }
 *                               storeId: { type: string, format: uuid }
 *                               serviceId: { type: string, format: uuid }
 *                               itemCount: { type: integer }
 *                               machineId: { type: string, format: uuid }
 *                               status: { type: string }
 *                               dueAt: { type: string, format: date-time }
 *                         page: { type: integer }
 *                         limit: { type: integer }
 *                         total: { type: integer }
 *       403:
 *         description: Your role is not allowed to call this.
 */
const listBatches = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await ProcessingService.listBatches(resolveStoreScope(req), req.query);
    return handleSuccessResponse({ statusCode: successCode, result }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /batches/suggestions:
 *   get:
 *     operationId: suggestBatches
 *     summary: "Suggested groupings by store, due date and service"
 *     description: "**Who can call this:** admin, manager, staff (super_admin always allowed)."
 *     tags: ["Store - Processing & Batches"]
 *     x-roles: [admin, manager, staff]
 *     parameters:
 *       - in: query
 *         name: storeId
 *         required: true
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
 *                         suggestions:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               serviceId: { type: string, format: uuid }
 *                               dueAt: { type: string, format: date-time }
 *                               orderItemIds: { type: array, items: { type: string, format: uuid } }
 *                               reason: { type: string }
 *       403:
 *         description: Your role is not allowed to call this.
 */
const suggestBatches = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await ProcessingService.suggestBatches(resolveStoreScope(req), req.query);
    return handleSuccessResponse({ statusCode: successCode, result }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /batches/{id}:
 *   get:
 *     operationId: getBatch
 *     summary: "Get a batch"
 *     description: "**Who can call this:** admin, manager, staff (super_admin always allowed)."
 *     tags: ["Store - Processing & Batches"]
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
const getBatch = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await ProcessingService.getBatch(req.params.id as string, resolveStoreScope(req));
    return handleSuccessResponse({ statusCode: successCode, result }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /batches/{id}/assign-machine:
 *   post:
 *     operationId: assignBatchMachine
 *     summary: "Assign a free machine to a batch"
 *     description: "**Who can call this:** admin, manager, staff (super_admin always allowed)."
 *     tags: ["Store - Processing & Batches"]
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
 *             required: [machineId]
 *             properties:
 *               machineId: { type: string, format: uuid }
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
 *         description: "That machine is not free."
 */
const assignBatchMachine = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await ProcessingService.assignBatchMachine(req.params.id as string, resolveStoreScope(req), req.body);
    return handleSuccessResponse({ statusCode: successCode, result }, res, "Machine assigned.");
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /batches/{id}/complete:
 *   post:
 *     operationId: completeBatch
 *     summary: "Mark the batch finished"
 *     description: "**Who can call this:** admin, manager, staff (super_admin always allowed)."
 *     tags: ["Store - Processing & Batches"]
 *     x-roles: [admin, manager, staff]
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
 *               loadWeightKg: { type: number }
 *               notes: { type: string }
 *     responses:
 *       200:
 *         description: "OK."
 *       400:
 *         description: "Missing or invalid fields."
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 */
const completeBatch = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await ProcessingService.completeBatch(req.params.id as string, resolveStoreScope(req), req.user as RequestUser, req.body);
    return handleSuccessResponse({ statusCode: successCode, result }, res, "Batch completed.");
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /batches/{id}/items:
 *   post:
 *     operationId: addItemsToBatch
 *     summary: "Add items to a batch"
 *     description: "**Who can call this:** admin, manager, staff (super_admin always allowed)."
 *     tags: ["Store - Processing & Batches"]
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
 *             required: [orderItemIds]
 *             properties:
 *               orderItemIds: { type: array, items: { type: string, format: uuid } }
 *     responses:
 *       200:
 *         description: "OK."
 *       400:
 *         description: "Missing or invalid fields."
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 */
const addItemsToBatch = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await ProcessingService.addItemsToBatch(req.params.id as string, resolveStoreScope(req), req.body);
    return handleSuccessResponse({ statusCode: successCode, result }, res, "Items added.");
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /batches/{id}/items/{itemId}:
 *   delete:
 *     operationId: removeItemFromBatch
 *     summary: "Take an item out of a batch"
 *     description: "**Who can call this:** admin, manager, staff (super_admin always allowed)."
 *     tags: ["Store - Processing & Batches"]
 *     x-roles: [admin, manager, staff]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: itemId
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
const removeItemFromBatch = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await ProcessingService.removeItemFromBatch(req.params.id as string, req.params.itemId as string, resolveStoreScope(req));
    return handleSuccessResponse({ statusCode: successCode, result }, res, "Item removed.");
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /batches/{id}/start:
 *   post:
 *     operationId: startBatch
 *     summary: "Start the batch"
 *     description: "**Who can call this:** admin, manager, staff (super_admin always allowed)."
 *     tags: ["Store - Processing & Batches"]
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
const startBatch = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await ProcessingService.startBatch(req.params.id as string, resolveStoreScope(req), req.user as RequestUser);
    return handleSuccessResponse({ statusCode: successCode, result }, res, "Batch started.");
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

export const StoreProcessingController = {
  createBatch,
  listBatches,
  suggestBatches,
  getBatch,
  assignBatchMachine,
  completeBatch,
  addItemsToBatch,
  removeItemFromBatch,
  startBatch,
};
