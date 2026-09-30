import { Request, Response } from "express";
import { handleErrorResponse, handleNotImplementedResponse, handleSuccessResponse } from "../../commons/Response/Response.js";
import { CustomException } from "../../commons/Exception/CustomException.js";
import { badRequest, created, successCode } from "../../commons/Utils/StatusCode.js";
import { IdentifiedRequest, RequestUser } from "../Middleware/Identity.js";
import { resolveStoreScope } from "../Middleware/StoreScope.js";
import { OrderService } from "../Services/Order.Service.js";

/**
 * @openapi
 * /orders/{id}:
 *   patch:
 *     summary: Update an order
 *     tags: ["Store - Orders"]
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
 *             properties:
 *               status: { type: string }
 *               items: { type: array, items: { type: object } }
 *     responses:
 *       200:
 *         description: Order updated.
 *       404:
 *         description: Order not found.
 *       501:
 *         description: Scaffolded per API contract — implementation pending.
 */
const update = async (_req: Request, res: Response) => {
  return handleNotImplementedResponse(res);
};

/**
 * @openapi
 * /orders/{id}/tags:
 *   post:
 *     summary: Generate printable QR tags for every item on an order
 *     tags: ["Store - Orders"]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       201:
 *         description: Tags generated.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 result:
 *                   type: object
 *                   properties:
 *                     tags:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           itemId: { type: string }
 *                           qrPayload: { type: string }
 *                           printUrl: { type: string }
 *       404:
 *         description: Order not found.
 *       501:
 *         description: Scaffolded per API contract — implementation pending.
 */
const generateTags = async (_req: Request, res: Response) => {
  return handleNotImplementedResponse(res);
};

/**
 * @openapi
 * /orders/{id}/discount:
 *   post:
 *     summary: Apply a discount to an order
 *     tags: ["Store - Orders"]
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
 *             required: [type, scope, value]
 *             properties:
 *               type: { type: string, enum: [flat, percentage] }
 *               scope: { type: string, enum: [customer, order, service] }
 *               value: { type: number }
 *               code: { type: string }
 *     responses:
 *       200:
 *         description: Discount applied.
 *       400:
 *         description: Missing required fields.
 *       404:
 *         description: Order not found.
 *       501:
 *         description: Scaffolded per API contract — implementation pending.
 */
const applyDiscount = async (req: Request, res: Response) => {
  try {
    const { type, scope, value } = req.body ?? {};
    if (!type || !scope || value === undefined) {
      throw new CustomException("type, scope, and value are required.", badRequest);
    }
    return handleNotImplementedResponse(res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /orders/{id}/payment:
 *   post:
 *     summary: Initiate payment for an order
 *     tags: ["Store - Orders"]
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
 *             required: [amount, method]
 *             properties:
 *               amount: { type: number }
 *               method: { type: string }
 *     responses:
 *       200:
 *         description: Payment initiated.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 result:
 *                   type: object
 *                   properties:
 *                     checkoutToken: { type: string }
 *                     paymentStatus: { type: string, example: pending }
 *       400:
 *         description: Missing required fields.
 *       404:
 *         description: Order not found.
 *       501:
 *         description: Scaffolded per API contract — implementation pending.
 */
const initiatePayment = async (req: Request, res: Response) => {
  try {
    const { amount, method } = req.body ?? {};
    if (amount === undefined || !method) {
      throw new CustomException("amount and method are required.", badRequest);
    }
    return handleNotImplementedResponse(res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /orders/{id}/return:
 *   post:
 *     summary: Return unprocessed garments on an order
 *     tags: ["Store - Orders"]
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
 *             required: [itemIds, reason]
 *             properties:
 *               itemIds: { type: array, items: { type: string } }
 *               reason: { type: string }
 *     responses:
 *       200:
 *         description: Items marked returned.
 *       400:
 *         description: Missing required fields.
 *       404:
 *         description: Order not found.
 *       501:
 *         description: Scaffolded per API contract — implementation pending.
 */
const returnItems = async (req: Request, res: Response) => {
  try {
    const { itemIds, reason } = req.body ?? {};
    if (!Array.isArray(itemIds) || itemIds.length === 0 || !reason) {
      throw new CustomException("itemIds (non-empty) and reason are required.", badRequest);
    }
    return handleNotImplementedResponse(res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /orders/{id}/finish:
 *   post:
 *     summary: Mark finishing/packing complete for an order (or specific items)
 *     tags: ["Store - Orders"]
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
 *             required: [processingStage]
 *             properties:
 *               itemIds: { type: array, items: { type: string } }
 *               processingStage: { type: string }
 *     responses:
 *       200:
 *         description: Processing stage updated.
 *       400:
 *         description: Missing required fields.
 *       404:
 *         description: Order not found.
 *       501:
 *         description: Scaffolded per API contract — implementation pending.
 */
const finish = async (req: Request, res: Response) => {
  try {
    const { processingStage } = req.body ?? {};
    if (!processingStage) {
      throw new CustomException("processingStage is required.", badRequest);
    }
    return handleNotImplementedResponse(res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /orders/{id}/packing-sticker:
 *   get:
 *     summary: Get print-ready packing sticker data for an order
 *     tags: ["Store - Orders"]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Packing sticker data.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 result:
 *                   type: object
 *                   properties:
 *                     orderId: { type: string }
 *                     items: { type: array, items: { type: object } }
 *                     storeName: { type: string }
 *                     barcodeUrl: { type: string }
 *       404:
 *         description: Order not found.
 *       501:
 *         description: Scaffolded per API contract — implementation pending.
 */
const packingSticker = async (_req: Request, res: Response) => {
  return handleNotImplementedResponse(res);
};

/**
 * @openapi
 * /orders:
 *   post:
 *     summary: Book an order (walk-in)
 *     description: >
 *       Prices come from the active price list on the server; any client-sent rate or amount is
 *       ignored. The store is the caller's effective store: an admin must send X-Store-Id of a
 *       live store, otherwise 400 "Choose a store.". `promisedAt` defaults to 24 h (express) or
 *       48 h (standard).
 *     tags: ["Store - Orders"]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [customerId, items]
 *             properties:
 *               customerId: { type: string, format: uuid }
 *               priority: { type: string, enum: [standard, express], default: standard }
 *               channel: { type: string, enum: [app, walk_in, web, phone], default: walk_in }
 *               paymentStatus: { type: string, enum: [paid, unpaid, part_paid], default: unpaid }
 *               promisedAt: { type: string, format: date-time }
 *               address: { type: string }
 *               care: { type: object, description: Partial CareProfile; absent fields get defaults. }
 *               items:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required: [serviceId, garment, category, qty]
 *                   properties:
 *                     serviceId: { type: string, format: uuid }
 *                     garment: { type: string }
 *                     category: { type: string, enum: [men, women, kids, household, premium] }
 *                     qty: { type: number, description: "Up to 3 decimals for kg; whole for piece/pair." }
 *                     unit: { type: string, enum: [kg, piece, pair], description: Must match the service. }
 *     responses:
 *       201:
 *         description: The created Order (dashboard shape) with items, care and a one-event timeline.
 *       400:
 *         description: Invalid field, unknown or unpriced service/garment, no store chosen.
 *       404:
 *         description: Customer not found (or belongs to another store).
 */
const create = async (req: IdentifiedRequest, res: Response) => {
  try {
    const order = await OrderService.create(resolveStoreScope(req), req.user as RequestUser, req.body);
    return handleSuccessResponse({ statusCode: created, result: order }, res, "Order booked.");
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /orders:
 *   get:
 *     summary: List orders, newest first
 *     description: Limited to the caller's store (admins - all, or the store in X-Store-Id).
 *     tags: ["Store - Orders"]
 *     parameters:
 *       - in: query
 *         name: status
 *         description: An order status, or `active` for everything not delivered/cancelled.
 *         schema: { type: string }
 *       - in: query
 *         name: priority
 *         schema: { type: string, enum: [standard, express] }
 *       - in: query
 *         name: paymentStatus
 *         schema: { type: string, enum: [paid, unpaid, part_paid] }
 *       - in: query
 *         name: customerId
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: q
 *         description: Matches order ref, customer name or phone.
 *         schema: { type: string }
 *       - in: query
 *         name: from
 *         description: Placed at or after (ISO date or date-time).
 *         schema: { type: string }
 *       - in: query
 *         name: to
 *         description: Placed at or before; a bare date includes that whole day.
 *         schema: { type: string }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 500, maximum: 1000 }
 *     responses:
 *       200:
 *         description: Order[] in the dashboard shape.
 *       400:
 *         description: Invalid filter.
 *       403:
 *         description: Manager or staff account without a store.
 */
const list = async (req: IdentifiedRequest, res: Response) => {
  try {
    const orders = await OrderService.list(resolveStoreScope(req), req.query);
    return handleSuccessResponse({ statusCode: successCode, result: orders }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /orders/pipeline:
 *   get:
 *     summary: Active orders per status
 *     description: Only statuses that have orders; delivered and cancelled are excluded.
 *     tags: ["Store - Orders"]
 *     responses:
 *       200:
 *         description: "[{ status, label, count }] in plant order."
 *       403:
 *         description: Manager or staff account without a store.
 */
const pipeline = async (req: IdentifiedRequest, res: Response) => {
  try {
    const rows = await OrderService.pipeline(resolveStoreScope(req));
    return handleSuccessResponse({ statusCode: successCode, result: rows }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /orders/{id}:
 *   get:
 *     summary: Get an order by id
 *     tags: ["Store - Orders"]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Full Order with items, timeline and care.
 *       404:
 *         description: Not found, or belongs to another store.
 */
const getById = async (req: IdentifiedRequest, res: Response) => {
  try {
    const order = await OrderService.getById(req.params.id as string, resolveStoreScope(req));
    return handleSuccessResponse({ statusCode: successCode, result: order }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /orders/{id}/status:
 *   post:
 *     summary: Move an order along its journey
 *     description: >
 *       One step forward along booked, picked_up, received, sorted, washing, drying,
 *       quality_check, packed, out_for_delivery, delivered; or one step back with a note
 *       (rework). Anything else is 400. delivered and cancelled are final; use the cancel
 *       action to cancel. Appends a timeline event in the same transaction.
 *     tags: ["Store - Orders"]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [status]
 *             properties:
 *               status: { type: string }
 *               note: { type: string }
 *     responses:
 *       200:
 *         description: The updated Order.
 *       400:
 *         description: Not a single forward step, a back step without a note, or a final order.
 *       404:
 *         description: Not found, or belongs to another store.
 */
const changeStatus = async (req: IdentifiedRequest, res: Response) => {
  try {
    const order = await OrderService.changeStatus(
      req.params.id as string,
      resolveStoreScope(req),
      req.user as RequestUser,
      req.body
    );
    return handleSuccessResponse({ statusCode: successCode, result: order }, res, "Order updated.");
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /orders/{id}/cancel:
 *   post:
 *     summary: Cancel an order
 *     description: Admin and manager only. Not allowed once out_for_delivery or delivered.
 *     tags: ["Store - Orders"]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [reason]
 *             properties:
 *               reason: { type: string }
 *     responses:
 *       200:
 *         description: The cancelled Order.
 *       400:
 *         description: Missing reason, or the order can no longer be cancelled.
 *       404:
 *         description: Not found, or belongs to another store.
 */
const cancel = async (req: IdentifiedRequest, res: Response) => {
  try {
    const order = await OrderService.cancel(
      req.params.id as string,
      resolveStoreScope(req),
      req.user as RequestUser,
      req.body
    );
    return handleSuccessResponse({ statusCode: successCode, result: order }, res, "Order cancelled.");
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

export const OrderController = {
  pipeline,
  changeStatus,
  cancel,
  create,
  list,
  getById,
  update,
  generateTags,
  applyDiscount,
  initiatePayment,
  returnItems,
  finish,
  packingSticker,
};
