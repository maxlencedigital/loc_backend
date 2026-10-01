import { Request, Response } from "express";
import { handleErrorResponse, handleSuccessResponse } from "../../commons/Response/Response.js";
import { successCode } from "../../commons/Utils/StatusCode.js";
import { OrderInternalService } from "../Services/OrderInternal.Service.js";

/**
 * @openapi
 * /internal/orders/summary:
 *   get:
 *     operationId: internalOrderSummary
 *     summary: "Order counts and revenue over a date range (service to service)"
 *     description: "Internal. SQL aggregates only, never rows. The range is at most 366 days and defaults to the last 30. Counts and revenue exclude cancelled orders; byStatus includes them. Days are Indian calendar days."
 *     tags: ["Internal - Orders"]
 *     parameters:
 *       - in: query
 *         name: from
 *         schema: { type: string, description: "ISO date or date and time" }
 *       - in: query
 *         name: to
 *         schema: { type: string, description: "ISO date (through the end of that day) or date and time" }
 *       - in: query
 *         name: storeId
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: "OK."
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 result:
 *                   type: object
 *                   properties:
 *                     orders: { type: integer }
 *                     revenuePaise: { type: integer }
 *                     byStatus: { type: object, additionalProperties: { type: integer } }
 *                     byDay:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           date: { type: string, format: date }
 *                           orders: { type: integer }
 *                           revenuePaise: { type: integer }
 *                     byStore:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           storeId: { type: string, format: uuid }
 *                           orders: { type: integer }
 *                           revenuePaise: { type: integer }
 *       400:
 *         description: "Invalid or too wide a range."
 */
const summary = async (req: Request, res: Response) => {
  try {
    return handleSuccessResponse(
      { statusCode: successCode, result: await OrderInternalService.summary(req.query) },
      res,
      "Order summary."
    );
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /internal/orders/{id}:
 *   get:
 *     operationId: internalGetOrder
 *     summary: "One order as other services need it (service to service)"
 *     description: "Internal. deliveryAddress and pickupWindow are extras beyond the agreed shape."
 *     tags: ["Internal - Orders"]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: "OK."
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 result:
 *                   type: object
 *                   properties:
 *                     id: { type: string, format: uuid }
 *                     ref: { type: string }
 *                     storeId: { type: string, format: uuid }
 *                     customerId: { type: string, format: uuid }
 *                     customerUserId: { type: string, format: uuid, nullable: true }
 *                     customerName: { type: string }
 *                     customerPhone: { type: string }
 *                     status: { type: string }
 *                     priority: { type: string, enum: [standard, express] }
 *                     paymentStatus: { type: string, enum: [paid, part_paid, unpaid] }
 *                     amountPaise: { type: integer }
 *                     paidPaise: { type: integer }
 *                     address: { type: string }
 *                     promisedAt: { type: string, format: date-time }
 *                     deliveryAddress: { type: string }
 *                     pickupWindow:
 *                       type: object
 *                       nullable: true
 *                       properties:
 *                         from: { type: string, format: date-time }
 *                         to: { type: string, format: date-time }
 *       404:
 *         description: "Order not found."
 */
const getOrder = async (req: Request, res: Response) => {
  try {
    return handleSuccessResponse(
      { statusCode: successCode, result: await OrderInternalService.getOrder(req.params.id as string) },
      res,
      "Order."
    );
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /internal/orders/{id}/payment-status:
 *   post:
 *     operationId: internalSetOrderPaymentStatus
 *     summary: "Record what has been paid against an order (service to service)"
 *     description: "Internal and idempotent. The paid total never decreases: an older or repeated message changes nothing. paymentStatus must agree with paidPaise and the order amount."
 *     tags: ["Internal - Orders"]
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
 *             required: [paymentStatus, paidPaise]
 *             properties:
 *               paymentStatus: { type: string, enum: [paid, part_paid, unpaid] }
 *               paidPaise: { type: integer, minimum: 0 }
 *     responses:
 *       200:
 *         description: "The updated order summary (same shape as GET /internal/orders/{id})."
 *       400:
 *         description: "Invalid body, or paymentStatus disagrees with paidPaise."
 *       404:
 *         description: "Order not found."
 */
const updatePaymentStatus = async (req: Request, res: Response) => {
  try {
    return handleSuccessResponse(
      { statusCode: successCode, result: await OrderInternalService.updatePaymentStatus(req.params.id as string, req.body) },
      res,
      "Payment status recorded."
    );
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /internal/orders/{id}/status:
 *   post:
 *     operationId: internalSetOrderStatus
 *     summary: "Move an order one step as a named system actor (service to service)"
 *     description: "Internal. Runs the normal status machine and row lock: one step forward, or one step back with a note. Cancelling is not done here."
 *     tags: ["Internal - Orders"]
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
 *             required: [status, actor]
 *             properties:
 *               status: { type: string }
 *               note: { type: string }
 *               actor:
 *                 type: object
 *                 required: [name]
 *                 properties:
 *                   name: { type: string, example: Logistics }
 *     responses:
 *       200:
 *         description: "The updated order summary (same shape as GET /internal/orders/{id})."
 *       400:
 *         description: "Invalid body or a transition the status machine refuses."
 *       404:
 *         description: "Order not found."
 */
const changeStatus = async (req: Request, res: Response) => {
  try {
    return handleSuccessResponse(
      { statusCode: successCode, result: await OrderInternalService.changeStatus(req.params.id as string, req.body) },
      res,
      "Order status updated."
    );
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

export const OrderInternalController = { summary, getOrder, updatePaymentStatus, changeStatus };
