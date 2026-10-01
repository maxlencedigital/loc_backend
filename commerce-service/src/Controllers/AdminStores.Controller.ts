import { Response } from "express";
import { handleErrorResponse, handleSuccessResponse } from "../../commons/Response/Response.js";
import { created, successCode } from "../../commons/Utils/StatusCode.js";
import { IdentifiedRequest } from "../Middleware/Identity.js";
import { resolveStoreScope } from "../Middleware/StoreScope.js";
import { AdminStoresService } from "../Services/AdminStores.Service.js";

/**
 * @openapi
 * /areas:
 *   get:
 *     operationId: listAreas
 *     summary: "List areas"
 *     description: "**Who can call this:** admin, hr, manager (super_admin always allowed)."
 *     tags: ["Admin - Stores & Areas"]
 *     x-roles: [admin, hr, manager]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, description: "1-based page number" }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, description: "page size, max 100" }
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
 *                               city: { type: string }
 *                               pincodes: { type: array, items: { type: string } }
 *                               createdAt: { type: string, format: date-time }
 *                               updatedAt: { type: string, format: date-time }
 *                         page: { type: integer }
 *                         limit: { type: integer }
 *                         total: { type: integer }
 *       403:
 *         description: Your role is not allowed to call this.
 */
const listAreas = async (req: IdentifiedRequest, res: Response) => {
  try {
    const scope = resolveStoreScope(req);
    const user = req.user as NonNullable<typeof req.user>;
    const result = await AdminStoresService.listAreas(scope, user, req.query);
    return handleSuccessResponse({ statusCode: successCode, result }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /areas:
 *   post:
 *     operationId: createArea
 *     summary: "Create an area"
 *     description: "**Who can call this:** admin (super_admin always allowed)."
 *     tags: ["Admin - Stores & Areas"]
 *     x-roles: [admin]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               name: { type: string }
 *               city: { type: string }
 *               pincodes: { type: array, items: { type: string } }
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
 *                         name: { type: string }
 *                         city: { type: string }
 *                         pincodes: { type: array, items: { type: string } }
 *                         createdAt: { type: string, format: date-time }
 *                         updatedAt: { type: string, format: date-time }
 *       400:
 *         description: "Missing or invalid fields."
 *       403:
 *         description: Your role is not allowed to call this.
 */
const createArea = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await AdminStoresService.createArea(req.body);
    return handleSuccessResponse({ statusCode: created, result }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /areas/{id}:
 *   get:
 *     operationId: getArea
 *     summary: "Get an area"
 *     description: "**Who can call this:** admin, hr, manager (super_admin always allowed)."
 *     tags: ["Admin - Stores & Areas"]
 *     x-roles: [admin, hr, manager]
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
 *                         name: { type: string }
 *                         city: { type: string }
 *                         pincodes: { type: array, items: { type: string } }
 *                         createdAt: { type: string, format: date-time }
 *                         updatedAt: { type: string, format: date-time }
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 */
const getArea = async (req: IdentifiedRequest, res: Response) => {
  try {
    const scope = resolveStoreScope(req);
    const user = req.user as NonNullable<typeof req.user>;
    const result = await AdminStoresService.getArea(scope, user, req.params.id);
    return handleSuccessResponse({ statusCode: successCode, result }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /areas/{id}:
 *   patch:
 *     operationId: updateArea
 *     summary: "Update an area"
 *     description: "**Who can call this:** admin (super_admin always allowed)."
 *     tags: ["Admin - Stores & Areas"]
 *     x-roles: [admin]
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
 *               name: { type: string }
 *               city: { type: string }
 *               pincodes: { type: array, items: { type: string } }
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
 *                         name: { type: string }
 *                         city: { type: string }
 *                         pincodes: { type: array, items: { type: string } }
 *                         createdAt: { type: string, format: date-time }
 *                         updatedAt: { type: string, format: date-time }
 *       400:
 *         description: "Missing or invalid fields."
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 */
const updateArea = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await AdminStoresService.updateArea(req.params.id, req.body);
    return handleSuccessResponse({ statusCode: successCode, result }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /areas/{id}:
 *   delete:
 *     operationId: deleteArea
 *     summary: "Delete an area"
 *     description: "**Who can call this:** admin (super_admin always allowed)."
 *     tags: ["Admin - Stores & Areas"]
 *     x-roles: [admin]
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
const deleteArea = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await AdminStoresService.deleteArea(req.params.id);
    return handleSuccessResponse({ statusCode: successCode, result }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /customers/{id}/stores:
 *   get:
 *     operationId: getCustomerStoreActivity
 *     summary: "One customer's activity across every store"
 *     description: "**Who can call this:** admin, hr, manager (super_admin always allowed). One view of every customer, regardless of which store they used."
 *     tags: ["Admin - Stores & Areas"]
 *     x-roles: [admin, hr, manager]
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
 *                         stores:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               storeId: { type: string, format: uuid }
 *                               name: { type: string }
 *                               orders: { type: integer }
 *                               lastOrderAt: { type: string, format: date-time }
 *                               spend: { type: number, description: "Amount in INR" }
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 */
const getCustomerStoreActivity = async (req: IdentifiedRequest, res: Response) => {
  try {
    const scope = resolveStoreScope(req);
    const user = req.user as NonNullable<typeof req.user>;
    const result = await AdminStoresService.getCustomerStoreActivity(scope, user, req.params.id);
    return handleSuccessResponse({ statusCode: successCode, result }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /stores/compare:
 *   get:
 *     operationId: compareStores
 *     summary: "Compare stores side by side"
 *     description: "**Who can call this:** admin, hr, manager (super_admin always allowed)."
 *     tags: ["Admin - Stores & Areas"]
 *     x-roles: [admin, hr, manager]
 *     parameters:
 *       - in: query
 *         name: ids
 *         schema: { type: array, items: { type: string, format: uuid } }
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
 *                         stores:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               storeId: { type: string, format: uuid }
 *                               name: { type: string }
 *                               revenue: { type: number, description: "Amount in INR" }
 *                               orders: { type: integer }
 *                               onTimePct: { type: number }
 *                               complaints: { type: integer }
 *       403:
 *         description: Your role is not allowed to call this.
 */
const compareStores = async (req: IdentifiedRequest, res: Response) => {
  try {
    const scope = resolveStoreScope(req);
    const result = await AdminStoresService.compareStores(scope, req.query);
    return handleSuccessResponse({ statusCode: successCode, result }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /stores/{id}/overview:
 *   get:
 *     operationId: getStoreOverview
 *     summary: "Any store's performance, without being there"
 *     description: "**Who can call this:** admin, hr, manager (super_admin always allowed)."
 *     tags: ["Admin - Stores & Areas"]
 *     x-roles: [admin, hr, manager]
 *     parameters:
 *       - in: path
 *         name: id
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
 *                         revenue: { type: number, description: "Amount in INR" }
 *                         orders: { type: integer }
 *                         onTimePct: { type: number }
 *                         capacityBottleneck: { type: string }
 *                         complaintsOpen: { type: integer }
 *                         staffOnShift: { type: integer }
 *                         cashVariance: { type: number, description: "Amount in INR" }
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 */
const getStoreOverview = async (req: IdentifiedRequest, res: Response) => {
  try {
    const scope = resolveStoreScope(req);
    const result = await AdminStoresService.getStoreOverview(scope, req.params.id, req.query);
    return handleSuccessResponse({ statusCode: successCode, result }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

export const AdminStoresController = {
  listAreas,
  createArea,
  getArea,
  updateArea,
  deleteArea,
  getCustomerStoreActivity,
  compareStores,
  getStoreOverview,
};
