import { Request, Response } from "express";
import { handleErrorResponse, handleNotImplementedResponse, handleSuccessResponse } from "../../commons/Response/Response.js";
import { created, successCode } from "../../commons/Utils/StatusCode.js";
import { IdentifiedRequest } from "../Middleware/Identity.js";
import { resolveStoreScope } from "../Middleware/StoreScope.js";
import { CustomerService } from "../Services/Customer.Service.js";

/**
 * @openapi
 * /customers/{id}/preferences:
 *   get:
 *     summary: Get a customer's preferences
 *     tags: ["Store - Customers"]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Customer preferences.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 result:
 *                   type: object
 *                   properties:
 *                     preferredChannel: { type: string }
 *                     garmentCareNotes: { type: string }
 *       404:
 *         description: Customer not found.
 *       501:
 *         description: Scaffolded per API contract — implementation pending.
 */
const getPreferences = async (_req: Request, res: Response) => {
  return handleNotImplementedResponse(res);
};

/**
 * @openapi
 * /customers/{id}/preferences:
 *   patch:
 *     summary: Update a customer's preferences
 *     tags: ["Store - Customers"]
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
 *               preferredChannel: { type: string, enum: [sms, email, whatsapp] }
 *               garmentCareNotes: { type: string }
 *     responses:
 *       200:
 *         description: Preferences updated.
 *       404:
 *         description: Customer not found.
 *       501:
 *         description: Scaffolded per API contract — implementation pending.
 */
const updatePreferences = async (_req: Request, res: Response) => {
  return handleNotImplementedResponse(res);
};

/**
 * @openapi
 * /customers:
 *   post:
 *     summary: Create a customer
 *     description: >
 *       A store-bound role creates in their own store. An admin names the store with
 *       X-Store-Id (or `storeId` in the body); otherwise 400 "Choose a store.".
 *       The phone number is unique across stores (409).
 *     tags: ["Store - Customers"]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, phone]
 *             properties:
 *               name: { type: string }
 *               phone: { type: string, example: "+91 98450 12345" }
 *               email: { type: string }
 *               type: { type: string, enum: [retail, corporate], default: retail }
 *               addresses: { type: array, items: { type: string } }
 *               tags: { type: array, items: { type: string } }
 *               storeId: { type: string, description: "Admin only, when no store is selected." }
 *     responses:
 *       201:
 *         description: The created Customer (dashboard shape).
 *       400:
 *         description: Invalid field, or no store chosen.
 *       403:
 *         description: Manager or staff account without a store.
 *       409:
 *         description: A customer with this phone number already exists.
 */
const create = async (req: IdentifiedRequest, res: Response) => {
  try {
    const customer = await CustomerService.create(resolveStoreScope(req), req.body);
    return handleSuccessResponse({ statusCode: created, result: customer }, res, "Customer created.");
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /customers:
 *   get:
 *     summary: List customers, newest first
 *     description: "Limited to the caller's store. Admins see all stores, or the one in X-Store-Id."
 *     tags: ["Store - Customers"]
 *     parameters:
 *       - in: query
 *         name: q
 *         description: Matches name, phone or email.
 *         schema: { type: string }
 *       - in: query
 *         name: segment
 *         schema: { type: string, enum: [retail, corporate] }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 500, maximum: 1000 }
 *     responses:
 *       200:
 *         description: Customer[] in the dashboard shape.
 *       400:
 *         description: Invalid filter.
 *       403:
 *         description: Manager or staff account without a store.
 */
const list = async (req: IdentifiedRequest, res: Response) => {
  try {
    const customers = await CustomerService.list(resolveStoreScope(req), req.query);
    return handleSuccessResponse({ statusCode: successCode, result: customers }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /customers/{id}:
 *   get:
 *     summary: Get a customer by id
 *     tags: ["Store - Customers"]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Customer in the dashboard shape.
 *       404:
 *         description: Not found, or belongs to another store.
 */
const getById = async (req: IdentifiedRequest, res: Response) => {
  try {
    const customer = await CustomerService.getById(req.params.id as string, resolveStoreScope(req));
    return handleSuccessResponse({ statusCode: successCode, result: customer }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /customers/{id}:
 *   patch:
 *     summary: Update a customer
 *     tags: ["Store - Customers"]
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
 *               phone: { type: string }
 *               email: { type: string }
 *               type: { type: string, enum: [retail, corporate] }
 *               addresses: { type: array, items: { type: string } }
 *               tags: { type: array, items: { type: string } }
 *     responses:
 *       200:
 *         description: The updated Customer.
 *       400:
 *         description: Invalid field.
 *       404:
 *         description: Not found, or belongs to another store.
 *       409:
 *         description: Another customer already has this phone number.
 */
const update = async (req: IdentifiedRequest, res: Response) => {
  try {
    const customer = await CustomerService.update(req.params.id as string, resolveStoreScope(req), req.body);
    return handleSuccessResponse({ statusCode: successCode, result: customer }, res, "Customer updated.");
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

export const CustomerController = {
  create,
  list,
  getById,
  update,
  getPreferences,
  updatePreferences,
};
