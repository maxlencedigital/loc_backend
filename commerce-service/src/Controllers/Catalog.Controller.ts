import { Request, Response } from "express";
import { handleErrorResponse, handleNotImplementedResponse, handleSuccessResponse } from "../../commons/Response/Response.js";
import { CustomException } from "../../commons/Exception/CustomException.js";
import { badRequest, created, successCode } from "../../commons/Utils/StatusCode.js";
import { CatalogService } from "../Services/Catalog.Service.js";

/**
 * @openapi
 * /services:
 *   post:
 *     summary: Create a service (e.g. wash-and-fold, dry cleaning)
 *     tags: ["Admin - Catalog & Pricing"]
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
 * /services/{id}:
 *   get:
 *     summary: Get a service by id
 *     tags: ["Admin - Catalog & Pricing"]
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
 *     tags: ["Admin - Catalog & Pricing"]
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
 *     tags: ["Admin - Catalog & Pricing"]
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
 *     tags: ["Admin - Catalog & Pricing"]
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
 *     tags: ["Admin - Catalog & Pricing"]
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
 *     tags: ["Admin - Catalog & Pricing"]
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
 *     tags: ["Admin - Catalog & Pricing"]
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
 *     tags: ["Admin - Catalog & Pricing"]
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
 * /price-lists/{id}:
 *   get:
 *     summary: Get a price list by id
 *     tags: ["Admin - Catalog & Pricing"]
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
 *   delete:
 *     summary: Delete a price list
 *     tags: ["Admin - Catalog & Pricing"]
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

/**
 * @openapi
 * /services:
 *   get:
 *     summary: List services
 *     tags: ["Admin - Catalog & Pricing"]
 *     responses:
 *       200:
 *         description: Service[] in the dashboard shape (id, name, department, unit, turnaroundHours, expressAvailable, active).
 */
const listServices = async (_req: Request, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await CatalogService.listServices() }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /price-lists:
 *   post:
 *     summary: Create a price list
 *     description: >
 *       Admin only. Orders are priced from the active lists; a list narrowed by storeId or
 *       customerType outranks the general one for matching orders.
 *     tags: ["Admin - Catalog & Pricing"]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               name: { type: string }
 *               appliesTo: { type: string }
 *               active: { type: boolean, default: true }
 *               storeId: { type: string, format: uuid }
 *               customerType: { type: string, enum: [retail, corporate] }
 *     responses:
 *       201:
 *         description: The created PriceList (no rows yet).
 *       400:
 *         description: Invalid field.
 *       409:
 *         description: A price list with this name already exists.
 */
const createPriceList = async (req: Request, res: Response) => {
  try {
    const list = await CatalogService.createList(req.body);
    return handleSuccessResponse({ statusCode: created, result: list }, res, "Price list created.");
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /price-lists:
 *   get:
 *     summary: List price lists
 *     tags: ["Admin - Catalog & Pricing"]
 *     responses:
 *       200:
 *         description: PriceList[] in the dashboard shape; `rows` is the row count.
 */
const listPriceLists = async (_req: Request, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await CatalogService.listPriceLists() }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /price-lists/{id}/rows:
 *   get:
 *     summary: List a price list's rows
 *     tags: ["Admin - Catalog & Pricing"]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: PriceRow[] in the dashboard shape (rates in rupees).
 *       404:
 *         description: Price list not found.
 */
const listPriceRows = async (req: Request, res: Response) => {
  try {
    return handleSuccessResponse(
      { statusCode: successCode, result: await CatalogService.listRows(req.params.id as string) },
      res
    );
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /price-lists/{id}:
 *   patch:
 *     summary: Rename, re-describe or (de)activate a price list
 *     description: Admin only.
 *     tags: ["Admin - Catalog & Pricing"]
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
 *               appliesTo: { type: string }
 *               active: { type: boolean }
 *     responses:
 *       200:
 *         description: The updated PriceList.
 *       400:
 *         description: Invalid field.
 *       404:
 *         description: Price list not found.
 *       409:
 *         description: A price list with this name already exists.
 */
const updatePriceList = async (req: Request, res: Response) => {
  try {
    const list = await CatalogService.updateList(req.params.id as string, req.body);
    return handleSuccessResponse({ statusCode: successCode, result: list }, res, "Price list updated.");
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /price-lists/{id}/duplicate:
 *   post:
 *     summary: Copy a price list with all its rows
 *     description: Admin only. The copy is named "<name> (copy)" and starts inactive.
 *     tags: ["Admin - Catalog & Pricing"]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       201:
 *         description: The new PriceList.
 *       404:
 *         description: Price list not found.
 */
const duplicatePriceList = async (req: Request, res: Response) => {
  try {
    const list = await CatalogService.duplicateList(req.params.id as string);
    return handleSuccessResponse({ statusCode: created, result: list }, res, "Price list duplicated.");
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /price-lists/{id}/rows/{rowId}:
 *   put:
 *     summary: Change a rate
 *     description: >
 *       Admin only. Rates are in rupees with at most two decimals. `expressRate` keeps its
 *       current value when omitted and may not be lower than `rate`. Affects new orders only.
 *     tags: ["Admin - Catalog & Pricing"]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: path
 *         name: rowId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [rate]
 *             properties:
 *               rate: { type: number }
 *               expressRate: { type: number }
 *     responses:
 *       200:
 *         description: The updated PriceRow.
 *       400:
 *         description: Invalid rate.
 *       404:
 *         description: Price list or row not found.
 */
const updatePriceRow = async (req: Request, res: Response) => {
  try {
    const row = await CatalogService.updateRow(req.params.id as string, req.params.rowId as string, req.body);
    return handleSuccessResponse({ statusCode: successCode, result: row }, res, "Rate updated.");
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

export const CatalogController = {
  listPriceRows,
  duplicatePriceList,
  updatePriceRow,
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
