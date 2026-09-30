import { Request, Response } from "express";
import { handleErrorResponse, handleNotImplementedResponse } from "../../commons/Response/Response.js";
import { requireFields } from "../../commons/Utils/Validation.js";

/**
 * @openapi
 * /orders/{id}/notes:
 *   post:
 *     operationId: addOrderNote
 *     summary: "Add an internal note to an order"
 *     description: "**Who can call this:** admin, manager, staff (super_admin always allowed)."
 *     tags: ["Store - Orders"]
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
 *             required: [note]
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
const addOrderNote = async (req: Request, res: Response) => {
  try {
    requireFields(req.body, ["note"]);
    return handleNotImplementedResponse(res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /orders/{id}/route-to-store:
 *   post:
 *     operationId: routeOrderToStore
 *     summary: "Send an order to a different store (closest, or has room)"
 *     description: "**Who can call this:** admin, manager (super_admin always allowed)."
 *     tags: ["Store - Orders"]
 *     x-roles: [admin, manager]
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
 *             required: [storeId]
 *             properties:
 *               storeId: { type: string, format: uuid }
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
const routeOrderToStore = async (req: Request, res: Response) => {
  try {
    requireFields(req.body, ["storeId"]);
    return handleNotImplementedResponse(res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /orders/{id}/timeline:
 *   get:
 *     operationId: getOrderTimeline
 *     summary: "Every status change on an order, for answering a customer at the counter"
 *     description: "**Who can call this:** admin, manager, staff (super_admin always allowed)."
 *     tags: ["Store - Orders"]
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
 *                         events:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               at: { type: string, format: date-time }
 *                               status: { type: string, enum: [placed, pickup_scheduled, picked_up, at_store, processing, quality_check, ready, out_for_delivery, delivered, cancelled] }
 *                               by: { type: string }
 *                               note: { type: string }
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 *       501:
 *         description: "Scaffolded per API contract — implementation pending."
 */
const getOrderTimeline = async (_req: Request, res: Response) => {
  try {
    return handleNotImplementedResponse(res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /walk-in/orders:
 *   post:
 *     operationId: createWalkInOrder
 *     summary: "Take a counter order for a walk-in customer"
 *     description: "**Who can call this:** admin, manager, staff (super_admin always allowed). Same care questions the customer app asks. Send either customerId or newCustomer."
 *     tags: ["Store - Orders"]
 *     x-roles: [admin, manager, staff]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [storeId, items]
 *             properties:
 *               customerId: { type: string, format: uuid }
 *               newCustomer:
 *                 type: object
 *                 required: [name, phone]
 *                 properties:
 *                   name: { type: string }
 *                   phone: { type: string, description: "E.164 phone number, e.g. +919876543210" }
 *                   email: { type: string, format: email }
 *               storeId: { type: string, format: uuid }
 *               items:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required: [garmentTypeId, serviceId]
 *                   properties:
 *                     garmentTypeId: { type: string, format: uuid }
 *                     serviceId: { type: string, format: uuid }
 *                     quantity: { type: integer, description: "pieces, for per-piece services" }
 *                     weightKg: { type: number, description: "kilograms, for by-weight services" }
 *                     fabric: { type: string, enum: [cotton, linen, wool, silk, synthetic, blend, denim, leather, unknown] }
 *                     note: { type: string }
 *               careAnswers:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required: [questionId, answer]
 *                   properties:
 *                     questionId: { type: string }
 *                     answer: { type: string, description: "a selected option, never free text" }
 *               careNotes: { type: string }
 *               express: { type: boolean }
 *               dueAt: { type: string, format: date-time }
 *               paymentMethod: { type: string, enum: [cash, upi, card, pay_later] }
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
 *                         orderId: { type: string, format: uuid }
 *                         orderNumber: { type: string }
 *                         amountDue: { type: number, description: "Amount in INR" }
 *                         paymentStatus: { type: string, enum: [unpaid, paid, partially_paid, refunded] }
 *       400:
 *         description: "Missing or invalid fields."
 *       403:
 *         description: Your role is not allowed to call this.
 *       501:
 *         description: "Scaffolded per API contract — implementation pending."
 */
const createWalkInOrder = async (req: Request, res: Response) => {
  try {
    requireFields(req.body, ["storeId", "items"]);
    return handleNotImplementedResponse(res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

export const StoreOrdersController = {
  addOrderNote,
  routeOrderToStore,
  getOrderTimeline,
  createWalkInOrder,
};
