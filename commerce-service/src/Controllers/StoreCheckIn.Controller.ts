import { Response } from "express";
import { handleErrorResponse, handleSuccessResponse } from "../../commons/Response/Response.js";
import { created, successCode } from "../../commons/Utils/StatusCode.js";
import { IdentifiedRequest, RequestUser } from "../Middleware/Identity.js";
import { resolveStoreScope } from "../Middleware/StoreScope.js";
import { CheckInService } from "../Services/CheckIn.Service.js";

/**
 * @openapi
 * /fabric-risk-rules:
 *   get:
 *     operationId: listFabricRiskRules
 *     summary: "Which fabrics are flagged higher-risk before they reach a machine"
 *     description: "**Who can call this:** admin, manager, staff (super_admin always allowed)."
 *     tags: ["Store - Check-in & Care"]
 *     x-roles: [admin, manager, staff]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, description: "1-based page number" }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, description: "page size, max 100" }
 *       - in: query
 *         name: fabric
 *         schema: { type: string, enum: [cotton, linen, wool, silk, synthetic, blend, denim, leather, unknown] }
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
 *                               fabric: { type: string, enum: [cotton, linen, wool, silk, synthetic, blend, denim, leather, unknown] }
 *                               risk: { type: string, enum: [low, medium, high] }
 *                               handling: { type: string }
 *                         page: { type: integer }
 *                         limit: { type: integer }
 *                         total: { type: integer }
 *       403:
 *         description: Your role is not allowed to call this.
 */
const listFabricRiskRules = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await CheckInService.listFabricRules(req.query);
    return handleSuccessResponse({ statusCode: successCode, result }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /orders/{id}/care-summary:
 *   get:
 *     operationId: getCareSummary
 *     summary: "Care needs for the order, at a glance"
 *     description: "**Who can call this:** admin, manager, staff (super_admin always allowed). Empty for a normal order. For a flagged one, the important details are right here."
 *     tags: ["Store - Check-in & Care"]
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
 *                         flagged: { type: boolean }
 *                         items:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               itemId: { type: string, format: uuid }
 *                               name: { type: string }
 *                               fabric: { type: string, enum: [cotton, linen, wool, silk, synthetic, blend, denim, leather, unknown] }
 *                               risk: { type: string, enum: [low, medium, high] }
 *                               flags: { type: array, items: { type: string } }
 *                               customerNotes: { type: string }
 *                               riderNotes: { type: string }
 *                               photos: { type: array, items: { type: string, format: uri } }
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 */
const getCareSummary = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await CheckInService.careSummary(req.params.id as string, resolveStoreScope(req));
    return handleSuccessResponse({ statusCode: successCode, result }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /orders/{id}/check-in:
 *   post:
 *     operationId: checkInOrder
 *     summary: "Receive the garments from the rider or the counter"
 *     description: "**Who can call this:** admin, manager, staff (super_admin always allowed). Each item is tagged so it is tracked through the whole process."
 *     tags: ["Store - Check-in & Care"]
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
 *             required: [receivedFrom, items]
 *             properties:
 *               receivedFrom: { type: string, enum: [rider, customer] }
 *               riderId: { type: string, format: uuid }
 *               items:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required: [garment, quantity]
 *                   properties:
 *                     garment: { type: string }
 *                     garmentTypeId: { type: string, format: uuid, description: "optional until the garment-type catalogue exists" }
 *                     serviceId: { type: string, format: uuid, description: "needed when the order has more than one service" }
 *                     quantity: { type: integer, description: "one tagged piece is created per unit" }
 *                     condition: { type: string, enum: [ok, stain, tear, loose_button, colour_fade, damaged, other] }
 *                     fabric: { type: string, enum: [cotton, linen, wool, silk, synthetic, blend, denim, leather, unknown] }
 *                     careFlags: { type: array, items: { type: string }, description: "e.g. delicate, cold_wash, hand_wash, no_tumble_dry" }
 *                     note: { type: string }
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
 *                         tagsToPrint: { type: array, items: { type: string } }
 *       400:
 *         description: "Missing or invalid fields."
 *       403:
 *         description: Your role is not allowed to call this.
 *       409:
 *         description: "The garment or order is past the stage where this can change."
 *       404:
 *         description: Not found.
 */
const checkInOrder = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await CheckInService.checkIn(req.params.id as string, resolveStoreScope(req), req.user as RequestUser, req.body);
    return handleSuccessResponse({ statusCode: successCode, result }, res, "Order checked in.");
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /orders/{id}/items:
 *   post:
 *     operationId: addOrderItem
 *     summary: "Add an item to an order"
 *     description: "**Who can call this:** admin, manager, staff (super_admin always allowed). Records an extra physical garment between check-in and the start of washing; it does not reprice the order."
 *     tags: ["Store - Check-in & Care"]
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
 *             required: [garment]
 *             properties:
 *               garment: { type: string }
 *               garmentTypeId: { type: string, format: uuid, description: "optional until the garment-type catalogue exists" }
 *               serviceId: { type: string, format: uuid, description: "needed when the order has more than one service" }
 *               quantity: { type: integer, description: "pieces to add, default 1; garments are counted, not weighed" }
 *               fabric: { type: string, enum: [cotton, linen, wool, silk, synthetic, blend, denim, leather, unknown] }
 *               note: { type: string }
 *               condition: { type: string, enum: [ok, stain, tear, loose_button, colour_fade, damaged, other] }
 *               careFlags: { type: array, items: { type: string }, description: "e.g. delicate, cold_wash, hand_wash, no_tumble_dry" }
 *     responses:
 *       201:
 *         description: "Created."
 *       400:
 *         description: "Missing or invalid fields."
 *       403:
 *         description: Your role is not allowed to call this.
 *       409:
 *         description: "The garment or order is past the stage where this can change."
 *       404:
 *         description: Not found.
 */
const addOrderItem = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await CheckInService.addItem(req.params.id as string, resolveStoreScope(req), req.user as RequestUser, req.body);
    return handleSuccessResponse({ statusCode: created, result }, res, "Garment added.");
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /orders/{id}/items/{itemId}:
 *   patch:
 *     operationId: updateOrderItem
 *     summary: "Update an item's condition, fabric or care flags"
 *     description: "**Who can call this:** admin, manager, staff (super_admin always allowed)."
 *     tags: ["Store - Check-in & Care"]
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
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               condition: { type: string, enum: [ok, stain, tear, loose_button, colour_fade, damaged, other] }
 *               fabric: { type: string, enum: [cotton, linen, wool, silk, synthetic, blend, denim, leather, unknown] }
 *               careFlags: { type: array, items: { type: string }, description: "e.g. delicate, cold_wash, hand_wash, no_tumble_dry" }
 *               note: { type: string }
 *     responses:
 *       200:
 *         description: "OK."
 *       400:
 *         description: "Missing or invalid fields."
 *       403:
 *         description: Your role is not allowed to call this.
 *       409:
 *         description: "The garment or order is past the stage where this can change."
 *       404:
 *         description: Not found.
 */
const updateOrderItem = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await CheckInService.updateItem(req.params.id as string, req.params.itemId as string, resolveStoreScope(req), req.user as RequestUser, req.body);
    return handleSuccessResponse({ statusCode: successCode, result }, res, "Garment updated.");
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /orders/{id}/items/{itemId}:
 *   delete:
 *     operationId: removeOrderItem
 *     summary: "Remove an item from an order"
 *     description: "**Who can call this:** admin, manager, staff (super_admin always allowed)."
 *     tags: ["Store - Check-in & Care"]
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
 *       409:
 *         description: "The garment or order is past the stage where this can change."
 *       404:
 *         description: Not found.
 */
const removeOrderItem = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await CheckInService.removeItem(req.params.id as string, req.params.itemId as string, resolveStoreScope(req), req.user as RequestUser);
    return handleSuccessResponse({ statusCode: successCode, result }, res, "Garment removed.");
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /orders/{id}/items/{itemId}/process:
 *   post:
 *     operationId: setItemProcess
 *     summary: "Record the wash and dry process staff decided on"
 *     description: "**Who can call this:** admin, manager, staff (super_admin always allowed)."
 *     tags: ["Store - Check-in & Care"]
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
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [wash, dry]
 *             properties:
 *               wash: { type: string }
 *               dry: { type: string }
 *               temperatureC: { type: integer }
 *               cycle: { type: string }
 *               overrideReason: { type: string, description: "required in practice when this differs from the suggestion" }
 *     responses:
 *       200:
 *         description: "OK."
 *       400:
 *         description: "Missing or invalid fields."
 *       403:
 *         description: Your role is not allowed to call this.
 *       409:
 *         description: "The garment or order is past the stage where this can change."
 *       404:
 *         description: Not found.
 */
const setItemProcess = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await CheckInService.setItemProcess(req.params.id as string, req.params.itemId as string, resolveStoreScope(req), req.user as RequestUser, req.body);
    return handleSuccessResponse({ statusCode: successCode, result }, res, "Process recorded.");
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /orders/{id}/items/{itemId}/process-suggestion:
 *   get:
 *     operationId: getProcessSuggestion
 *     summary: "The system's suggested wash and dry process for an item"
 *     description: "**Who can call this:** admin, manager, staff (super_admin always allowed). A suggestion only — staff make the final call."
 *     tags: ["Store - Check-in & Care"]
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
 *                         risk: { type: string, enum: [low, medium, high] }
 *                         recommended:
 *                           type: object
 *                           properties:
 *                             wash: { type: string }
 *                             dry: { type: string }
 *                             temperatureC: { type: integer }
 *                             cycle: { type: string }
 *                             notes: { type: string }
 *                         reasons: { type: array, items: { type: string } }
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 */
const getProcessSuggestion = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await CheckInService.getProcessSuggestion(req.params.id as string, req.params.itemId as string, resolveStoreScope(req));
    return handleSuccessResponse({ statusCode: successCode, result }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

export const StoreCheckInController = {
  listFabricRiskRules,
  getCareSummary,
  checkInOrder,
  addOrderItem,
  updateOrderItem,
  removeOrderItem,
  setItemProcess,
  getProcessSuggestion,
};
