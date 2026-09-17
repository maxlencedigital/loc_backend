import { Request, Response } from "express";
import { handleErrorResponse, handleNotImplementedResponse } from "../../commons/Response/Response.js";
import { CustomException } from "../../commons/Exception/CustomException.js";
import { badRequest } from "../../commons/Utils/StatusCode.js";

/**
 * @openapi
 * /customers:
 *   post:
 *     summary: Create a customer
 *     tags: [Customers]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, phoneNumber]
 *             properties:
 *               name: { type: string }
 *               phoneNumber: { type: string }
 *               email: { type: string }
 *               preferredChannel: { type: string, enum: [sms, email, whatsapp] }
 *     responses:
 *       201:
 *         description: Customer created.
 *       400:
 *         description: Missing required fields.
 *       501:
 *         description: Scaffolded per API contract — implementation pending.
 */
const create = async (req: Request, res: Response) => {
  try {
    const { name, phoneNumber } = req.body ?? {};
    if (!name || !phoneNumber) {
      throw new CustomException("name and phoneNumber are required.", badRequest);
    }
    return handleNotImplementedResponse(res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /customers:
 *   get:
 *     summary: List/search customers
 *     tags: [Customers]
 *     parameters:
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *     responses:
 *       200:
 *         description: Paginated customer list.
 *       501:
 *         description: Scaffolded per API contract — implementation pending.
 */
const list = async (_req: Request, res: Response) => {
  return handleNotImplementedResponse(res);
};

/**
 * @openapi
 * /customers/{id}:
 *   get:
 *     summary: Get a customer by id
 *     tags: [Customers]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Customer detail.
 *       404:
 *         description: Customer not found.
 *       501:
 *         description: Scaffolded per API contract — implementation pending.
 */
const getById = async (_req: Request, res: Response) => {
  return handleNotImplementedResponse(res);
};

/**
 * @openapi
 * /customers/{id}:
 *   patch:
 *     summary: Update a customer
 *     tags: [Customers]
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
 *               phoneNumber: { type: string }
 *               email: { type: string }
 *     responses:
 *       200:
 *         description: Customer updated.
 *       404:
 *         description: Customer not found.
 *       501:
 *         description: Scaffolded per API contract — implementation pending.
 */
const update = async (_req: Request, res: Response) => {
  return handleNotImplementedResponse(res);
};

/**
 * @openapi
 * /customers/{id}/preferences:
 *   get:
 *     summary: Get a customer's preferences
 *     tags: [Customers]
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
 *     tags: [Customers]
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

export const CustomerController = {
  create,
  list,
  getById,
  update,
  getPreferences,
  updatePreferences,
};
