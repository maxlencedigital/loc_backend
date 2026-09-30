import { Request, Response } from "express";
import { handleErrorResponse, handleNotImplementedResponse, handleSuccessResponse } from "../../commons/Response/Response.js";
import { CustomException } from "../../commons/Exception/CustomException.js";
import { badRequest, created, successCode } from "../../commons/Utils/StatusCode.js";
import { IdentifiedRequest } from "../Middleware/Identity.js";
import { resolveStoreScope } from "../Middleware/StoreScope.js";
import { StoreService } from "../Services/Store.Service.js";

/**
 * @openapi
 * /stores/{id}/stock/reconcile:
 *   post:
 *     summary: Reconcile counted stock against expected stock for a store
 *     tags: ["Store - Day Operations"]
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
 *             required: [counts]
 *             properties:
 *               counts:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required: [stockItemId, countedQty]
 *                   properties:
 *                     stockItemId: { type: string }
 *                     countedQty: { type: number }
 *     responses:
 *       200:
 *         description: Reconciliation result.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 result:
 *                   type: object
 *                   properties:
 *                     variances:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           stockItemId: { type: string }
 *                           expectedQty: { type: number }
 *                           countedQty: { type: number }
 *                           variance: { type: number }
 *       400:
 *         description: Missing required fields.
 *       404:
 *         description: Store not found.
 *       501:
 *         description: Scaffolded per API contract — implementation pending.
 */
const reconcileStock = async (req: Request, res: Response) => {
  try {
    const { counts } = req.body ?? {};
    if (!Array.isArray(counts) || counts.length === 0) {
      throw new CustomException("counts (non-empty array) is required.", badRequest);
    }
    return handleNotImplementedResponse(res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /stores/{id}/holidays:
 *   post:
 *     summary: Add a store holiday (skipped in due-date calculations)
 *     tags: ["Store - Day Operations"]
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
 *               reason: { type: string }
 *     responses:
 *       201:
 *         description: Holiday added.
 *       400:
 *         description: Missing required fields.
 *       404:
 *         description: Store not found.
 *       501:
 *         description: Scaffolded per API contract — implementation pending.
 */
const addHoliday = async (req: Request, res: Response) => {
  try {
    const { date } = req.body ?? {};
    if (!date) {
      throw new CustomException("date is required.", badRequest);
    }
    return handleNotImplementedResponse(res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /stores/{id}/holidays:
 *   get:
 *     summary: List a store's holidays
 *     tags: ["Store - Day Operations"]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: year
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Holiday list.
 *       404:
 *         description: Store not found.
 *       501:
 *         description: Scaffolded per API contract — implementation pending.
 */
const listHolidays = async (_req: Request, res: Response) => {
  return handleNotImplementedResponse(res);
};

/**
 * @openapi
 * /stores/{id}/holidays/{holidayId}:
 *   delete:
 *     summary: Remove a store holiday
 *     tags: ["Store - Day Operations"]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: holidayId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       204:
 *         description: Holiday removed.
 *       404:
 *         description: Holiday not found.
 *       501:
 *         description: Scaffolded per API contract — implementation pending.
 */
const removeHoliday = async (_req: Request, res: Response) => {
  return handleNotImplementedResponse(res);
};

/**
 * @openapi
 * /stores/{id}/employees/{employeeId}/performance:
 *   get:
 *     summary: Get an employee's performance aggregate for a store
 *     tags: ["Store - Day Operations"]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: employeeId
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
 *         description: Performance aggregate.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 result:
 *                   type: object
 *                   properties:
 *                     ordersHandled: { type: integer }
 *                     avgTurnaroundHours: { type: number }
 *       404:
 *         description: Store or employee not found.
 *       501:
 *         description: Scaffolded per API contract — implementation pending.
 */
const employeePerformance = async (_req: Request, res: Response) => {
  return handleNotImplementedResponse(res);
};

/**
 * @openapi
 * /stores/{id}/reports/daily:
 *   get:
 *     summary: Get a store's daily cash/sales report
 *     tags: ["Store - Day Operations"]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: date
 *         schema: { type: string, format: date }
 *     responses:
 *       200:
 *         description: Daily report.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 result:
 *                   type: object
 *                   properties:
 *                     date: { type: string, format: date }
 *                     totalOrders: { type: integer }
 *                     totalRevenue: { type: number }
 *                     cashCollected: { type: number }
 *                     digitalCollected: { type: number }
 *       404:
 *         description: Store not found.
 *       501:
 *         description: Scaffolded per API contract — implementation pending.
 */
const dailyReport = async (_req: Request, res: Response) => {
  return handleNotImplementedResponse(res);
};

/**
 * @openapi
 * /stores:
 *   get:
 *     summary: List stores
 *     description: Admins see every store (or the one in X-Store-Id); manager and staff see only their own.
 *     tags: ["Admin - Stores"]
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [live, planned, closed] }
 *     responses:
 *       200:
 *         description: Store[] in the dashboard shape (managerName and staffCount are merged by the dashboard from users).
 *       403:
 *         description: Manager or staff account without a store.
 */
const list = async (req: IdentifiedRequest, res: Response) => {
  try {
    const stores = await StoreService.list(resolveStoreScope(req), req.query);
    return handleSuccessResponse({ statusCode: successCode, result: stores }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /stores:
 *   post:
 *     summary: Create a store
 *     description: Admin only.
 *     tags: ["Admin - Stores"]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [code, name, city, address, type, openingHours, capacityKgPerDay]
 *             properties:
 *               code: { type: string, example: BLR-IND }
 *               name: { type: string }
 *               city: { type: string }
 *               address: { type: string }
 *               type: { type: string, enum: [processing, pickup_hub, franchise] }
 *               openingHours: { type: string }
 *               capacityKgPerDay: { type: integer }
 *               status: { type: string, enum: [live, planned, closed], default: live }
 *     responses:
 *       201:
 *         description: The created Store.
 *       400:
 *         description: Invalid field.
 *       409:
 *         description: A store with this code already exists.
 */
const create = async (req: Request, res: Response) => {
  try {
    const store = await StoreService.create(req.body);
    return handleSuccessResponse({ statusCode: created, result: store }, res, "Store created.");
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /stores/{id}:
 *   get:
 *     summary: Get a store
 *     description: Admins any store; manager and staff their own only (404 otherwise).
 *     tags: ["Admin - Stores"]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Store in the dashboard shape.
 *       404:
 *         description: Not found, or not the caller's store.
 */
const getById = async (req: IdentifiedRequest, res: Response) => {
  try {
    const store = await StoreService.getById(req.params.id as string, resolveStoreScope(req));
    return handleSuccessResponse({ statusCode: successCode, result: store }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /stores/{id}:
 *   patch:
 *     summary: Update a store
 *     description: Admin only. The code cannot be changed.
 *     tags: ["Admin - Stores"]
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
 *             properties:
 *               name: { type: string }
 *               city: { type: string }
 *               address: { type: string }
 *               type: { type: string, enum: [processing, pickup_hub, franchise] }
 *               openingHours: { type: string }
 *               capacityKgPerDay: { type: integer }
 *               status: { type: string, enum: [live, planned, closed] }
 *     responses:
 *       200:
 *         description: The updated Store.
 *       400:
 *         description: Invalid field.
 *       404:
 *         description: Store not found.
 */
const update = async (req: Request, res: Response) => {
  try {
    const store = await StoreService.update(req.params.id as string, req.body);
    return handleSuccessResponse({ statusCode: successCode, result: store }, res, "Store updated.");
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /stores/{id}/deactivate:
 *   post:
 *     summary: Close a store
 *     description: Admin only. Sets the status to closed; existing orders and customers are kept.
 *     tags: ["Admin - Stores"]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: The Store with status closed.
 *       404:
 *         description: Store not found.
 */
const deactivate = async (req: Request, res: Response) => {
  try {
    const store = await StoreService.deactivate(req.params.id as string);
    return handleSuccessResponse({ statusCode: successCode, result: store }, res, "Store closed.");
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

export const StoreController = {
  list,
  create,
  getById,
  update,
  deactivate,
  reconcileStock,
  addHoliday,
  listHolidays,
  removeHoliday,
  employeePerformance,
  dailyReport,
};
