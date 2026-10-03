import { Response } from "express";
import { handleErrorResponse, handleSuccessResponse } from "../../commons/Response/Response.js";
import { successCode } from "../../commons/Utils/StatusCode.js";
import { IdentifiedRequest } from "../Middleware/Identity.js";
import { resolveStoreScope } from "../Middleware/StoreScope.js";
import { StoreStockService } from "../Services/StoreStock.Service.js";

/**
 * @openapi
 * /stores/{id}/stock:
 *   get:
 *     operationId: listStoreStock
 *     summary: "Stock levels at a store"
 *     description: "**Who can call this:** admin, manager, staff (super_admin always allowed). Quantities are the purchasing module's stock records: only materials the store has held are listed."
 *     tags: ["Store - Stock & Materials"]
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
 *         name: category
 *         schema: { type: string }
 *       - in: query
 *         name: lowOnly
 *         schema: { type: boolean }
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
 *                               name: { type: string }
 *                               unit: { type: string }
 *                               quantity: { type: number }
 *                               reorderLevel: { type: number }
 *                               status: { type: string, enum: [ok, low, critical, out] }
 *                         page: { type: integer }
 *                         limit: { type: integer }
 *                         total: { type: integer }
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 */
const listStoreStock = async (req: IdentifiedRequest, res: Response) => {
  try {
    const scope = resolveStoreScope(req);
    const result = await StoreStockService.listStoreStock(scope, req.params.id, req.query);
    return handleSuccessResponse({ statusCode: successCode, result }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /stores/{id}/stock/alerts:
 *   get:
 *     operationId: listStockAlerts
 *     summary: "Open low-stock alerts"
 *     description: "**Who can call this:** admin, hr, manager, staff (super_admin always allowed). Paged (page, limit; the result also carries page, limit, total). Combines items at or below their reorder level with the floor's flags."
 *     tags: ["Store - Stock & Materials"]
 *     x-roles: [admin, hr, manager, staff]
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
 *                         alerts:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               id: { type: string, format: uuid }
 *                               itemId: { type: string, format: uuid }
 *                               name: { type: string }
 *                               level: { type: string, enum: [low, critical, out] }
 *                               raisedBy: { type: string }
 *                               raisedAt: { type: string, format: date-time }
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 */
const listStockAlerts = async (req: IdentifiedRequest, res: Response) => {
  try {
    const scope = resolveStoreScope(req);
    const result = await StoreStockService.listStockAlerts(scope, req.params.id, req.query);
    return handleSuccessResponse({ statusCode: successCode, result }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /stores/{id}/stock/{itemId}:
 *   get:
 *     operationId: getStoreStockItem
 *     summary: "One stock item"
 *     description: "**Who can call this:** admin, manager, staff (super_admin always allowed)."
 *     tags: ["Store - Stock & Materials"]
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
const getStoreStockItem = async (req: IdentifiedRequest, res: Response) => {
  try {
    const scope = resolveStoreScope(req);
    const result = await StoreStockService.getStoreStockItem(scope, req.params.id, req.params.itemId);
    return handleSuccessResponse({ statusCode: successCode, result }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /stores/{id}/stock/{itemId}/low-alert:
 *   post:
 *     operationId: flagLowStock
 *     summary: "Flag a material as running low, from the floor"
 *     description: "**Who can call this:** admin, manager, staff (super_admin always allowed). Reaches whoever does the ordering before the store actually runs out."
 *     tags: ["Store - Stock & Materials"]
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
 *             required: [level]
 *             properties:
 *               level: { type: string, enum: [low, critical, out] }
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
 */
const flagLowStock = async (req: IdentifiedRequest, res: Response) => {
  try {
    const scope = resolveStoreScope(req);
    const user = req.user as NonNullable<typeof req.user>;
    const result = await StoreStockService.flagLowStock(scope, user, req.params.id, req.params.itemId, req.body);
    return handleSuccessResponse({ statusCode: successCode, result }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

export const StoreStockController = {
  listStoreStock,
  listStockAlerts,
  getStoreStockItem,
  flagLowStock,
};
