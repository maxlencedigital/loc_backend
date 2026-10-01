import { Response } from "express";
import { handleErrorResponse, handleSuccessResponse } from "../../commons/Response/Response.js";
import { successCode } from "../../commons/Utils/StatusCode.js";
import { IdentifiedRequest, RequestUser } from "../Middleware/Identity.js";
import { CustomerOrdersService } from "../Services/CustomerOrders.Service.js";

/**
 * @openapi
 * /me/orders:
 *   get:
 *     operationId: listMyOrders
 *     summary: "My order history"
 *     description: "**Who can call this:** customer (super_admin always allowed)."
 *     tags: ["Customer - Orders & Tracking"]
 *     x-roles: [customer]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, description: "1-based page number" }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, description: "page size, max 100" }
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [placed, pickup_scheduled, picked_up, at_store, processing, quality_check, ready, out_for_delivery, delivered, cancelled] }
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
 *                               orderNumber: { type: string }
 *                               status: { type: string, enum: [placed, pickup_scheduled, picked_up, at_store, processing, quality_check, ready, out_for_delivery, delivered, cancelled] }
 *                               express: { type: boolean }
 *                               total: { type: number, description: "Amount in INR" }
 *                               paymentStatus: { type: string, enum: [unpaid, paid, partially_paid, refunded] }
 *                               storeId: { type: string, format: uuid }
 *                               pickupSlot:
 *                                 type: object
 *                                 properties:
 *                                   from: { type: string, format: date-time }
 *                                   to: { type: string, format: date-time }
 *                               placedAt: { type: string, format: date-time }
 *                         page: { type: integer }
 *                         limit: { type: integer }
 *                         total: { type: integer }
 *       403:
 *         description: Your role is not allowed to call this.
 */
const listMyOrders = async (req: IdentifiedRequest, res: Response) => {
  try {
    const user = req.user as RequestUser;
    const result = await CustomerOrdersService.listMyOrders(user, req.query);
    return handleSuccessResponse({ statusCode: successCode, result }, res, "Orders.");
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /me/orders/{id}:
 *   get:
 *     operationId: getMyOrder
 *     summary: "One of my orders, in full"
 *     description: "**Who can call this:** customer (super_admin always allowed)."
 *     tags: ["Customer - Orders & Tracking"]
 *     x-roles: [customer]
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
 *                         id: { type: string, format: uuid }
 *                         orderNumber: { type: string }
 *                         status: { type: string, enum: [placed, pickup_scheduled, picked_up, at_store, processing, quality_check, ready, out_for_delivery, delivered, cancelled] }
 *                         express: { type: boolean }
 *                         total: { type: number, description: "Amount in INR" }
 *                         paymentStatus: { type: string, enum: [unpaid, paid, partially_paid, refunded] }
 *                         storeId: { type: string, format: uuid }
 *                         pickupSlot:
 *                           type: object
 *                           properties:
 *                             from: { type: string, format: date-time }
 *                             to: { type: string, format: date-time }
 *                         placedAt: { type: string, format: date-time }
 *                         items:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               id: { type: string, format: uuid }
 *                               garmentType: { type: string }
 *                               service: { type: string }
 *                               quantity: { type: integer }
 *                               status: { type: string }
 *                               careFlags: { type: array, items: { type: string } }
 *                         timeline:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               stage: { type: string }
 *                               at: { type: string, format: date-time }
 *                               done: { type: boolean }
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 */
const getMyOrder = async (req: IdentifiedRequest, res: Response) => {
  try {
    const user = req.user as RequestUser;
    const result = await CustomerOrdersService.getMyOrder(user, req.params.id as string);
    return handleSuccessResponse({ statusCode: successCode, result }, res, "Order.");
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /me/orders/{id}/cancel:
 *   post:
 *     operationId: cancelMyOrder
 *     summary: "Cancel an order that has not been picked up"
 *     description: "**Who can call this:** customer (super_admin always allowed). Allowed only while the order is still booked (the rider has not collected it); the pickup seat is released. Cancelling twice is harmless. Any refund is not handled here."
 *     tags: ["Customer - Orders & Tracking"]
 *     x-roles: [customer]
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
 *       409:
 *         description: "The order can no longer be cancelled."
 */
const cancelMyOrder = async (req: IdentifiedRequest, res: Response) => {
  try {
    const user = req.user as RequestUser;
    const result = await CustomerOrdersService.cancelMyOrder(user, req.params.id as string, req.body);
    return handleSuccessResponse({ statusCode: successCode, result }, res, "Order cancelled.");
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /me/orders/{id}/invoice:
 *   get:
 *     operationId: getMyOrderInvoice
 *     summary: "The invoice for an order"
 *     description: "**Who can call this:** customer (super_admin always allowed). There is no invoice store yet: the invoice is the order record, numbered INV- plus the order number, and downloadUrl is null. A cancelled order has none."
 *     tags: ["Customer - Orders & Tracking"]
 *     x-roles: [customer]
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
 *                         invoiceNumber: { type: string }
 *                         issuedAt: { type: string, format: date-time }
 *                         total: { type: number, description: "Amount in INR" }
 *                         downloadUrl: { type: string, format: uri }
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 */
const getMyOrderInvoice = async (req: IdentifiedRequest, res: Response) => {
  try {
    const user = req.user as RequestUser;
    const result = await CustomerOrdersService.getMyOrderInvoice(user, req.params.id as string);
    return handleSuccessResponse({ statusCode: successCode, result }, res, "Invoice.");
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /me/orders/{id}/reorder:
 *   post:
 *     operationId: reorderMyOrder
 *     summary: "Start a new order from a past one"
 *     description: "**Who can call this:** customer (super_admin always allowed). Returns a draft basket and the address used last (the default address if it was deleted); nothing is priced or booked."
 *     tags: ["Customer - Orders & Tracking"]
 *     x-roles: [customer]
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
 *                         addressId: { type: string, format: uuid }
 *                         items:
 *                           type: array
 *                           items:
 *                             type: object
 *                             required: [garmentTypeId, serviceId]
 *                             properties:
 *                               garmentTypeId: { type: string, format: uuid }
 *                               serviceId: { type: string, format: uuid }
 *                               quantity: { type: integer, description: "pieces, for per-piece services" }
 *                               weightKg: { type: number, description: "kilograms, for by-weight services" }
 *                               fabric: { type: string, enum: [cotton, linen, wool, silk, synthetic, blend, denim, leather, unknown] }
 *                               note: { type: string }
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 */
const reorderMyOrder = async (req: IdentifiedRequest, res: Response) => {
  try {
    const user = req.user as RequestUser;
    const result = await CustomerOrdersService.reorderMyOrder(user, req.params.id as string);
    return handleSuccessResponse({ statusCode: successCode, result }, res, "Basket from your past order.");
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /me/orders/{id}/reschedule:
 *   post:
 *     operationId: rescheduleMyPickup
 *     summary: "Move the pickup to another slot"
 *     description: "**Who can call this:** customer (super_admin always allowed). Same store only, while the order is still booked and at least 60 minutes before its window opens."
 *     tags: ["Customer - Orders & Tracking"]
 *     x-roles: [customer]
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
 *             required: [pickupSlotId]
 *             properties:
 *               pickupSlotId: { type: string, format: uuid }
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
const rescheduleMyPickup = async (req: IdentifiedRequest, res: Response) => {
  try {
    const user = req.user as RequestUser;
    const result = await CustomerOrdersService.rescheduleMyPickup(user, req.params.id as string, req.body);
    return handleSuccessResponse({ statusCode: successCode, result }, res, "Pickup rescheduled.");
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /me/orders/{id}/tracking:
 *   get:
 *     operationId: trackMyOrder
 *     summary: "Where is my order right now?"
 *     description: "**Who can call this:** customer (super_admin always allowed). rider is null until one is assigned; phone, ETA and position are null because logistics is not connected yet."
 *     tags: ["Customer - Orders & Tracking"]
 *     x-roles: [customer]
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
 *                         status: { type: string, enum: [placed, pickup_scheduled, picked_up, at_store, processing, quality_check, ready, out_for_delivery, delivered, cancelled] }
 *                         stages:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               stage: { type: string }
 *                               at: { type: string, format: date-time }
 *                               done: { type: boolean }
 *                         rider:
 *                           type: object
 *                           properties:
 *                             name: { type: string }
 *                             phone: { type: string, description: "E.164 phone number, e.g. +919876543210" }
 *                             etaMinutes: { type: integer }
 *                             latitude: { type: number }
 *                             longitude: { type: number }
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 */
const trackMyOrder = async (req: IdentifiedRequest, res: Response) => {
  try {
    const user = req.user as RequestUser;
    const result = await CustomerOrdersService.trackMyOrder(user, req.params.id as string);
    return handleSuccessResponse({ statusCode: successCode, result }, res, "Order tracking.");
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

export const CustomerOrdersController = {
  listMyOrders,
  getMyOrder,
  cancelMyOrder,
  getMyOrderInvoice,
  reorderMyOrder,
  rescheduleMyPickup,
  trackMyOrder,
};
