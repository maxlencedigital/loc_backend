import { Response } from "express";
import { handleErrorResponse, handleSuccessResponse } from "../../commons/Response/Response.js";
import { created, successCode } from "../../commons/Utils/StatusCode.js";
import { IdentifiedRequest, RequestUser } from "../Middleware/Identity.js";
import { resolveStoreScope } from "../Middleware/StoreScope.js";
import { StoreOrdersService } from "../Services/StoreOrders.Service.js";

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
 *       409:
 *         description: "The order is not in a state that allows this, or the request is already being processed."
 *       404:
 *         description: Not found.
 */
const addOrderNote = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await StoreOrdersService.addOrderNote(req.params.id as string, resolveStoreScope(req), req.user as RequestUser, req.body);
    return handleSuccessResponse({ statusCode: successCode, result }, res, "Note added.");
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
 *       409:
 *         description: "The order is not in a state that allows this, or the request is already being processed."
 *       404:
 *         description: Not found.
 */
const routeOrderToStore = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await StoreOrdersService.routeOrderToStore(req.params.id as string, resolveStoreScope(req), req.user as RequestUser, req.body);
    return handleSuccessResponse({ statusCode: successCode, result }, res, "Order sent to the other store.");
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
 *                               status: { type: string, enum: [booked, picked_up, received, sorted, washing, drying, quality_check, packed, out_for_delivery, delivered, cancelled] }
 *                               by: { type: string }
 *                               note: { type: string }
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 */
const getOrderTimeline = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await StoreOrdersService.getOrderTimeline(req.params.id as string, resolveStoreScope(req));
    return handleSuccessResponse({ statusCode: successCode, result }, res);
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
 *     description: "**Who can call this:** admin, manager, staff (super_admin always allowed). Same care questions the customer app asks. Send either customerId or newCustomer. Prices come from the active price list on the server. Send an Idempotency-Key header to make a retry return the first order. Paying by cash, upi or card books the order as paid; pay_later leaves it unpaid."
 *     tags: ["Store - Orders"]
 *     x-roles: [admin, manager, staff]
 *     parameters:
 *       - in: header
 *         name: Idempotency-Key
 *         schema: { type: string, maxLength: 80 }
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
 *                   required: [serviceId, garment, category]
 *                   properties:
 *                     garmentTypeId: { type: string, format: uuid, description: "optional until the garment-type catalogue exists" }
 *                     garment: { type: string, description: "the garment's name, as on the price list" }
 *                     category: { type: string, enum: [men, women, kids, household, premium] }
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
 *                         paymentStatus: { type: string, enum: [unpaid, paid, part_paid] }
 *       400:
 *         description: "Missing or invalid fields."
 *       403:
 *         description: Your role is not allowed to call this.
 *       409:
 *         description: "The order is not in a state that allows this, or the request is already being processed."
 */
const createWalkInOrder = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await StoreOrdersService.createWalkInOrder(resolveStoreScope(req), req.user as RequestUser, req.body, req.header("Idempotency-Key"));
    return handleSuccessResponse({ statusCode: created, result }, res, "Order booked.");
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
