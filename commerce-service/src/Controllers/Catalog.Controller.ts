import { Request, Response } from "express";
import { handleErrorResponse, handleNotImplementedResponse } from "../../commons/Response/Response.js";
import { CustomException } from "../../commons/Exception/CustomException.js";
import { badRequest } from "../../commons/Utils/StatusCode.js";

// ------------------------------- Services -------------------------------

/**
 * @openapi
 * /services:
 *   post:
 *     summary: Create a service (e.g. wash-and-fold, dry cleaning)
 *     tags: [Catalog]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, basePrice, storeId]
 *             properties:
 *               name: { type: string }
 *               basePrice: { type: number }
 *               storeId: { type: string }
 *     responses:
 *       201:
 *         description: Service created.
 *       400:
 *         description: Missing required fields.
 *       501:
 *         description: Scaffolded per API contract — implementation pending.
 */
const createService = async (req: Request, res: Response) => {
  try {
    const { name, basePrice, storeId } = req.body ?? {};
    if (!name || basePrice === undefined || !storeId) {
      throw new CustomException("name, basePrice, and storeId are required.", badRequest);
    }
    return handleNotImplementedResponse(res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /services:
 *   get:
 *     summary: List services
 *     tags: [Catalog]
 *     parameters:
 *       - in: query
 *         name: storeId
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Service list.
 *       501:
 *         description: Scaffolded per API contract — implementation pending.
 */
const listServices = async (_req: Request, res: Response) => {
  return handleNotImplementedResponse(res);
};

/**
 * @openapi
 * /services/{id}:
 *   get:
 *     summary: Get a service by id
 *     tags: [Catalog]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Service detail.
 *       404:
 *         description: Service not found.
 *       501:
 *         description: Scaffolded per API contract — implementation pending.
 */
const getService = async (_req: Request, res: Response) => {
  return handleNotImplementedResponse(res);
};

/**
 * @openapi
 * /services/{id}:
 *   patch:
 *     summary: Update a service
 *     tags: [Catalog]
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
 *               name: { type: string }
 *               basePrice: { type: number }
 *     responses:
 *       200:
 *         description: Service updated.
 *       404:
 *         description: Service not found.
 *       501:
 *         description: Scaffolded per API contract — implementation pending.
 */
const updateService = async (_req: Request, res: Response) => {
  return handleNotImplementedResponse(res);
};

/**
 * @openapi
 * /services/{id}:
 *   delete:
 *     summary: Delete a service
 *     tags: [Catalog]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       204:
 *         description: Service deleted.
 *       404:
 *         description: Service not found.
 *       501:
 *         description: Scaffolded per API contract — implementation pending.
 */
const deleteService = async (_req: Request, res: Response) => {
  return handleNotImplementedResponse(res);
};

// ----------------------------- Garment Types -----------------------------

/**
 * @openapi
 * /garment-types:
 *   post:
 *     summary: Create a garment type
 *     tags: [Catalog]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, category]
 *             properties:
 *               name: { type: string }
 *               category: { type: string }
 *     responses:
 *       201:
 *         description: Garment type created.
 *       400:
 *         description: Missing required fields.
 *       501:
 *         description: Scaffolded per API contract — implementation pending.
 */
const createGarmentType = async (req: Request, res: Response) => {
  try {
    const { name, category } = req.body ?? {};
    if (!name || !category) {
      throw new CustomException("name and category are required.", badRequest);
    }
    return handleNotImplementedResponse(res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /garment-types:
 *   get:
 *     summary: List garment types
 *     tags: [Catalog]
 *     responses:
 *       200:
 *         description: Garment type list.
 *       501:
 *         description: Scaffolded per API contract — implementation pending.
 */
const listGarmentTypes = async (_req: Request, res: Response) => {
  return handleNotImplementedResponse(res);
};

/**
 * @openapi
 * /garment-types/{id}:
 *   get:
 *     summary: Get a garment type by id
 *     tags: [Catalog]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Garment type detail.
 *       404:
 *         description: Garment type not found.
 *       501:
 *         description: Scaffolded per API contract — implementation pending.
 */
const getGarmentType = async (_req: Request, res: Response) => {
  return handleNotImplementedResponse(res);
};

/**
 * @openapi
 * /garment-types/{id}:
 *   patch:
 *     summary: Update a garment type
 *     tags: [Catalog]
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
 *               name: { type: string }
 *               category: { type: string }
 *     responses:
 *       200:
 *         description: Garment type updated.
 *       404:
 *         description: Garment type not found.
 *       501:
 *         description: Scaffolded per API contract — implementation pending.
 */
const updateGarmentType = async (_req: Request, res: Response) => {
  return handleNotImplementedResponse(res);
};

/**
 * @openapi
 * /garment-types/{id}:
 *   delete:
 *     summary: Delete a garment type
 *     tags: [Catalog]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       204:
 *         description: Garment type deleted.
 *       404:
 *         description: Garment type not found.
 *       501:
 *         description: Scaffolded per API contract — implementation pending.
 */
const deleteGarmentType = async (_req: Request, res: Response) => {
  return handleNotImplementedResponse(res);
};

// ------------------------------ Price Lists ------------------------------

/**
 * @openapi
 * /price-lists:
 *   post:
 *     summary: Create a price list
 *     tags: [Catalog]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, storeId, entries]
 *             properties:
 *               name: { type: string }
 *               storeId: { type: string }
 *               entries:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required: [serviceId, garmentTypeId, price]
 *                   properties:
 *                     serviceId: { type: string }
 *                     garmentTypeId: { type: string }
 *                     price: { type: number }
 *     responses:
 *       201:
 *         description: Price list created.
 *       400:
 *         description: Missing required fields.
 *       501:
 *         description: Scaffolded per API contract — implementation pending.
 */
const createPriceList = async (req: Request, res: Response) => {
  try {
    const { name, storeId, entries } = req.body ?? {};
    if (!name || !storeId || !Array.isArray(entries) || entries.length === 0) {
      throw new CustomException("name, storeId, and at least one entry are required.", badRequest);
    }
    return handleNotImplementedResponse(res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /price-lists:
 *   get:
 *     summary: List price lists
 *     tags: [Catalog]
 *     parameters:
 *       - in: query
 *         name: storeId
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Price list summary list.
 *       501:
 *         description: Scaffolded per API contract — implementation pending.
 */
const listPriceLists = async (_req: Request, res: Response) => {
  return handleNotImplementedResponse(res);
};

/**
 * @openapi
 * /price-lists/{id}:
 *   get:
 *     summary: Get a price list by id
 *     tags: [Catalog]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Price list detail with entries.
 *       404:
 *         description: Price list not found.
 *       501:
 *         description: Scaffolded per API contract — implementation pending.
 */
const getPriceList = async (_req: Request, res: Response) => {
  return handleNotImplementedResponse(res);
};

/**
 * @openapi
 * /price-lists/{id}:
 *   patch:
 *     summary: Update a price list
 *     tags: [Catalog]
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
 *               name: { type: string }
 *               entries: { type: array, items: { type: object } }
 *     responses:
 *       200:
 *         description: Price list updated.
 *       404:
 *         description: Price list not found.
 *       501:
 *         description: Scaffolded per API contract — implementation pending.
 */
const updatePriceList = async (_req: Request, res: Response) => {
  return handleNotImplementedResponse(res);
};

/**
 * @openapi
 * /price-lists/{id}:
 *   delete:
 *     summary: Delete a price list
 *     tags: [Catalog]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       204:
 *         description: Price list deleted.
 *       404:
 *         description: Price list not found.
 *       501:
 *         description: Scaffolded per API contract — implementation pending.
 */
const deletePriceList = async (_req: Request, res: Response) => {
  return handleNotImplementedResponse(res);
};

export const CatalogController = {
  createService,
  listServices,
  getService,
  updateService,
  deleteService,
  createGarmentType,
  listGarmentTypes,
  getGarmentType,
  updateGarmentType,
  deleteGarmentType,
  createPriceList,
  listPriceLists,
  getPriceList,
  updatePriceList,
  deletePriceList,
};
