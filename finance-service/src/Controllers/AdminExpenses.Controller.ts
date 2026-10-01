import { Response } from "express";
import { IdentifiedRequest } from "../Middleware/Identity.js";
import { actorOf } from "../Middleware/StoreScope.js";
import { handleErrorResponse, handleSuccessResponse } from "../../commons/Response/Response.js";
import { parsePage } from "../../commons/Utils/Pagination.js";
import { created, successCode } from "../../commons/Utils/StatusCode.js";
import { ExpenseService } from "../Services/Expense.Service.js";
import { OperatingCostService } from "../Services/OperatingCost.Service.js";
import { MAX_RECEIPT_BYTES } from "../Services/Expense.Service.js";
import { readMultipart } from "../Utils/Multipart.js";

/**
 * @openapi
 * /expense-categories:
 *   get:
 *     operationId: listExpenseCategories
 *     summary: "List expense categories"
 *     description: "**Who can call this:** admin (super_admin always allowed)."
 *     tags: ["Admin - Expenses & Operating Costs"]
 *     x-roles: [admin]
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
 *                               parentId: { type: string, format: uuid }
 *                               createdAt: { type: string, format: date-time }
 *                               updatedAt: { type: string, format: date-time }
 *                         page: { type: integer }
 *                         limit: { type: integer }
 *                         total: { type: integer }
 *       403:
 *         description: Your role is not allowed to call this.
 */
const listExpenseCategories = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await ExpenseService.listCategories(parsePage(req.query as Record<string, unknown>));
    return handleSuccessResponse({ statusCode: successCode, result }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /expense-categories:
 *   post:
 *     operationId: createExpenseCategory
 *     summary: "Create an expense category"
 *     description: "**Who can call this:** admin (super_admin always allowed)."
 *     tags: ["Admin - Expenses & Operating Costs"]
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
 *               parentId: { type: string, format: uuid }
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
 *                         parentId: { type: string, format: uuid }
 *                         createdAt: { type: string, format: date-time }
 *                         updatedAt: { type: string, format: date-time }
 *       400:
 *         description: "Missing or invalid fields."
 *       403:
 *         description: Your role is not allowed to call this.
 */
const createExpenseCategory = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await ExpenseService.createCategory(req.body);
    return handleSuccessResponse({ statusCode: created, result }, res, "Expense category created.");
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /expense-categories/{id}:
 *   get:
 *     operationId: getExpenseCategory
 *     summary: "Get an expense category"
 *     description: "**Who can call this:** admin (super_admin always allowed)."
 *     tags: ["Admin - Expenses & Operating Costs"]
 *     x-roles: [admin]
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
 *                         parentId: { type: string, format: uuid }
 *                         createdAt: { type: string, format: date-time }
 *                         updatedAt: { type: string, format: date-time }
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 */
const getExpenseCategory = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await ExpenseService.getCategory(req.params.id as string);
    return handleSuccessResponse({ statusCode: successCode, result }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /expense-categories/{id}:
 *   patch:
 *     operationId: updateExpenseCategory
 *     summary: "Update an expense category"
 *     description: "**Who can call this:** admin (super_admin always allowed)."
 *     tags: ["Admin - Expenses & Operating Costs"]
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
 *               parentId: { type: string, format: uuid }
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
 *                         parentId: { type: string, format: uuid }
 *                         createdAt: { type: string, format: date-time }
 *                         updatedAt: { type: string, format: date-time }
 *       400:
 *         description: "Missing or invalid fields."
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 */
const updateExpenseCategory = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await ExpenseService.updateCategory(req.params.id as string, req.body);
    return handleSuccessResponse({ statusCode: successCode, result }, res, "Expense category updated.");
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /expense-categories/{id}:
 *   delete:
 *     operationId: deleteExpenseCategory
 *     summary: "Delete an expense category"
 *     description: "**Who can call this:** admin (super_admin always allowed)."
 *     tags: ["Admin - Expenses & Operating Costs"]
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
const deleteExpenseCategory = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await ExpenseService.deleteCategory(req.params.id as string);
    return handleSuccessResponse({ statusCode: successCode, result }, res, "Expense category deleted.");
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /expenses:
 *   get:
 *     operationId: listExpenses
 *     summary: "List expenses"
 *     description: "**Who can call this:** admin, manager (super_admin always allowed)."
 *     tags: ["Admin - Expenses & Operating Costs"]
 *     x-roles: [admin, manager]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, description: "1-based page number" }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, description: "page size, max 100" }
 *       - in: query
 *         name: storeId
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: categoryId
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [recorded, approved, rejected] }
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
 *                               date: { type: string, format: date }
 *                               categoryId: { type: string, format: uuid }
 *                               amount: { type: number, description: "Amount in INR" }
 *                               storeId: { type: string, format: uuid }
 *                               vendorId: { type: string, format: uuid }
 *                               description: { type: string }
 *                               paymentMode: { type: string, enum: [cash, bank, upi, card] }
 *                               status: { type: string, enum: [recorded, approved, rejected] }
 *                               createdAt: { type: string, format: date-time }
 *                               updatedAt: { type: string, format: date-time }
 *                         page: { type: integer }
 *                         limit: { type: integer }
 *                         total: { type: integer }
 *       403:
 *         description: Your role is not allowed to call this.
 */
const listExpenses = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await ExpenseService.listExpenses(req.query as Record<string, unknown>, actorOf(req), parsePage(req.query as Record<string, unknown>));
    return handleSuccessResponse({ statusCode: successCode, result }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /expenses:
 *   post:
 *     operationId: createExpense
 *     summary: "Create an expense"
 *     description: "**Who can call this:** admin (super_admin always allowed). A new expense is always recorded; approval is a separate step with its own history. Idempotent through the Idempotency-Key header."
 *     tags: ["Admin - Expenses & Operating Costs"]
 *     x-roles: [admin]
 *     parameters:
 *       - in: header
 *         name: Idempotency-Key
 *         required: false
 *         schema: { type: string, maxLength: 128 }
 *         description: "A retry with the same key returns the first result instead of creating a second record."
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [date, categoryId, amount]
 *             properties:
 *               date: { type: string, format: date }
 *               categoryId: { type: string, format: uuid }
 *               amount: { type: number, description: "Amount in INR" }
 *               storeId: { type: string, format: uuid }
 *               vendorId: { type: string, format: uuid }
 *               description: { type: string }
 *               paymentMode: { type: string, enum: [cash, bank, upi, card] }
 *               status: { type: string, enum: [recorded, approved, rejected] }
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
 *                         date: { type: string, format: date }
 *                         categoryId: { type: string, format: uuid }
 *                         amount: { type: number, description: "Amount in INR" }
 *                         storeId: { type: string, format: uuid }
 *                         vendorId: { type: string, format: uuid }
 *                         description: { type: string }
 *                         paymentMode: { type: string, enum: [cash, bank, upi, card] }
 *                         status: { type: string, enum: [recorded, approved, rejected] }
 *                         createdAt: { type: string, format: date-time }
 *                         updatedAt: { type: string, format: date-time }
 *       400:
 *         description: "Missing or invalid fields."
 *       403:
 *         description: Your role is not allowed to call this.
 */
const createExpense = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await ExpenseService.createExpense(req.body, actorOf(req), req.header("idempotency-key"));
    return handleSuccessResponse({ statusCode: created, result }, res, "Expense recorded.");
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /expenses/{id}:
 *   get:
 *     operationId: getExpense
 *     summary: "Get an expense"
 *     description: "**Who can call this:** admin, manager (super_admin always allowed)."
 *     tags: ["Admin - Expenses & Operating Costs"]
 *     x-roles: [admin, manager]
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
 *                         date: { type: string, format: date }
 *                         categoryId: { type: string, format: uuid }
 *                         amount: { type: number, description: "Amount in INR" }
 *                         storeId: { type: string, format: uuid }
 *                         vendorId: { type: string, format: uuid }
 *                         description: { type: string }
 *                         paymentMode: { type: string, enum: [cash, bank, upi, card] }
 *                         status: { type: string, enum: [recorded, approved, rejected] }
 *                         createdAt: { type: string, format: date-time }
 *                         updatedAt: { type: string, format: date-time }
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 */
const getExpense = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await ExpenseService.getExpense(req.params.id as string, actorOf(req));
    return handleSuccessResponse({ statusCode: successCode, result }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /expenses/{id}:
 *   patch:
 *     operationId: updateExpense
 *     summary: "Update an expense"
 *     description: "**Who can call this:** admin (super_admin always allowed)."
 *     tags: ["Admin - Expenses & Operating Costs"]
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
 *               date: { type: string, format: date }
 *               categoryId: { type: string, format: uuid }
 *               amount: { type: number, description: "Amount in INR" }
 *               storeId: { type: string, format: uuid }
 *               vendorId: { type: string, format: uuid }
 *               description: { type: string }
 *               paymentMode: { type: string, enum: [cash, bank, upi, card] }
 *               status: { type: string, enum: [recorded, approved, rejected] }
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
 *                         date: { type: string, format: date }
 *                         categoryId: { type: string, format: uuid }
 *                         amount: { type: number, description: "Amount in INR" }
 *                         storeId: { type: string, format: uuid }
 *                         vendorId: { type: string, format: uuid }
 *                         description: { type: string }
 *                         paymentMode: { type: string, enum: [cash, bank, upi, card] }
 *                         status: { type: string, enum: [recorded, approved, rejected] }
 *                         createdAt: { type: string, format: date-time }
 *                         updatedAt: { type: string, format: date-time }
 *       400:
 *         description: "Missing or invalid fields."
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 */
const updateExpense = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await ExpenseService.updateExpense(req.params.id as string, req.body, actorOf(req));
    return handleSuccessResponse({ statusCode: successCode, result }, res, "Expense updated.");
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /expenses/{id}:
 *   delete:
 *     operationId: deleteExpense
 *     summary: "Delete an expense"
 *     description: "**Who can call this:** admin (super_admin always allowed)."
 *     tags: ["Admin - Expenses & Operating Costs"]
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
const deleteExpense = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await ExpenseService.deleteExpense(req.params.id as string, actorOf(req));
    return handleSuccessResponse({ statusCode: successCode, result }, res, "Expense deleted.");
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /expenses/{id}/approve:
 *   post:
 *     operationId: approveExpense
 *     summary: "Approve an expense"
 *     description: "**Who can call this:** admin (super_admin always allowed)."
 *     tags: ["Admin - Expenses & Operating Costs"]
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
const approveExpense = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await ExpenseService.approveExpense(req.params.id as string, req.body, actorOf(req));
    return handleSuccessResponse({ statusCode: successCode, result }, res, "Expense approved.");
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /expenses/{id}/receipt:
 *   post:
 *     operationId: uploadExpenseReceipt
 *     summary: "Attach a receipt"
 *     description: "**Who can call this:** admin (super_admin always allowed)."
 *     tags: ["Admin - Expenses & Operating Costs"]
 *     x-roles: [admin]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [file]
 *             properties:
 *               file: { type: string, format: binary }
 *     responses:
 *       201:
 *         description: "Created."
 *       400:
 *         description: "Missing or invalid fields."
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 */
const uploadExpenseReceipt = async (req: IdentifiedRequest, res: Response) => {
  try {
    const upload = await readMultipart(req, MAX_RECEIPT_BYTES + 16_384);
    const file = upload.files.find((f) => f.field === "file");
    const result = await ExpenseService.attachReceipt(req.params.id as string, file, actorOf(req));
    return handleSuccessResponse({ statusCode: created, result }, res, "Receipt attached.");
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /operating-costs:
 *   get:
 *     operationId: listOperatingCosts
 *     summary: "List operating costs"
 *     description: "**Who can call this:** admin (super_admin always allowed)."
 *     tags: ["Admin - Expenses & Operating Costs"]
 *     x-roles: [admin]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, description: "1-based page number" }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, description: "page size, max 100" }
 *       - in: query
 *         name: storeId
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: type
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
 *                         items:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               id: { type: string, format: uuid }
 *                               name: { type: string }
 *                               type: { type: string, enum: [rent, electricity, water, internet, salary, insurance, maintenance, other] }
 *                               amount: { type: number, description: "Amount in INR" }
 *                               frequency: { type: string, enum: [monthly, quarterly, yearly] }
 *                               storeId: { type: string, format: uuid }
 *                               dueDay: { type: integer }
 *                               startDate: { type: string, format: date }
 *                               endDate: { type: string, format: date }
 *                               vendorId: { type: string, format: uuid }
 *                               createdAt: { type: string, format: date-time }
 *                               updatedAt: { type: string, format: date-time }
 *                         page: { type: integer }
 *                         limit: { type: integer }
 *                         total: { type: integer }
 *       403:
 *         description: Your role is not allowed to call this.
 */
const listOperatingCosts = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await OperatingCostService.listOperatingCosts(req.query as Record<string, unknown>, actorOf(req), parsePage(req.query as Record<string, unknown>));
    return handleSuccessResponse({ statusCode: successCode, result }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /operating-costs:
 *   post:
 *     operationId: createOperatingCost
 *     summary: "Create an operating cost"
 *     description: "**Who can call this:** admin (super_admin always allowed)."
 *     tags: ["Admin - Expenses & Operating Costs"]
 *     x-roles: [admin]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, type, amount, frequency, startDate]
 *             properties:
 *               name: { type: string }
 *               type: { type: string, enum: [rent, electricity, water, internet, salary, insurance, maintenance, other] }
 *               amount: { type: number, description: "Amount in INR" }
 *               frequency: { type: string, enum: [monthly, quarterly, yearly] }
 *               storeId: { type: string, format: uuid }
 *               dueDay: { type: integer }
 *               startDate: { type: string, format: date }
 *               endDate: { type: string, format: date }
 *               vendorId: { type: string, format: uuid }
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
 *                         type: { type: string, enum: [rent, electricity, water, internet, salary, insurance, maintenance, other] }
 *                         amount: { type: number, description: "Amount in INR" }
 *                         frequency: { type: string, enum: [monthly, quarterly, yearly] }
 *                         storeId: { type: string, format: uuid }
 *                         dueDay: { type: integer }
 *                         startDate: { type: string, format: date }
 *                         endDate: { type: string, format: date }
 *                         vendorId: { type: string, format: uuid }
 *                         createdAt: { type: string, format: date-time }
 *                         updatedAt: { type: string, format: date-time }
 *       400:
 *         description: "Missing or invalid fields."
 *       403:
 *         description: Your role is not allowed to call this.
 */
const createOperatingCost = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await OperatingCostService.createOperatingCost(req.body);
    return handleSuccessResponse({ statusCode: created, result }, res, "Operating cost created.");
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /operating-costs/monthly:
 *   get:
 *     operationId: getMonthlyOperatingCost
 *     summary: "What it costs to run the business for a month — a number to look up, not estimate"
 *     description: "**Who can call this:** admin (super_admin always allowed)."
 *     tags: ["Admin - Expenses & Operating Costs"]
 *     x-roles: [admin]
 *     parameters:
 *       - in: query
 *         name: month
 *         required: true
 *         schema: { type: string, description: "YYYY-MM" }
 *       - in: query
 *         name: storeId
 *         schema: { type: string, format: uuid }
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
 *                         total: { type: number, description: "Amount in INR" }
 *                         byType:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               type: { type: string }
 *                               amount: { type: number, description: "Amount in INR" }
 *                         byStore:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               storeId: { type: string, format: uuid }
 *                               amount: { type: number, description: "Amount in INR" }
 *       403:
 *         description: Your role is not allowed to call this.
 */
const getMonthlyOperatingCost = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await OperatingCostService.getMonthlyOperatingCost(req.query as Record<string, unknown>, actorOf(req));
    return handleSuccessResponse({ statusCode: successCode, result }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /operating-costs/{id}:
 *   get:
 *     operationId: getOperatingCost
 *     summary: "Get an operating cost"
 *     description: "**Who can call this:** admin (super_admin always allowed)."
 *     tags: ["Admin - Expenses & Operating Costs"]
 *     x-roles: [admin]
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
 *                         type: { type: string, enum: [rent, electricity, water, internet, salary, insurance, maintenance, other] }
 *                         amount: { type: number, description: "Amount in INR" }
 *                         frequency: { type: string, enum: [monthly, quarterly, yearly] }
 *                         storeId: { type: string, format: uuid }
 *                         dueDay: { type: integer }
 *                         startDate: { type: string, format: date }
 *                         endDate: { type: string, format: date }
 *                         vendorId: { type: string, format: uuid }
 *                         createdAt: { type: string, format: date-time }
 *                         updatedAt: { type: string, format: date-time }
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 */
const getOperatingCost = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await OperatingCostService.getOperatingCost(req.params.id as string);
    return handleSuccessResponse({ statusCode: successCode, result }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /operating-costs/{id}:
 *   patch:
 *     operationId: updateOperatingCost
 *     summary: "Update an operating cost"
 *     description: "**Who can call this:** admin (super_admin always allowed)."
 *     tags: ["Admin - Expenses & Operating Costs"]
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
 *               type: { type: string, enum: [rent, electricity, water, internet, salary, insurance, maintenance, other] }
 *               amount: { type: number, description: "Amount in INR" }
 *               frequency: { type: string, enum: [monthly, quarterly, yearly] }
 *               storeId: { type: string, format: uuid }
 *               dueDay: { type: integer }
 *               startDate: { type: string, format: date }
 *               endDate: { type: string, format: date }
 *               vendorId: { type: string, format: uuid }
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
 *                         type: { type: string, enum: [rent, electricity, water, internet, salary, insurance, maintenance, other] }
 *                         amount: { type: number, description: "Amount in INR" }
 *                         frequency: { type: string, enum: [monthly, quarterly, yearly] }
 *                         storeId: { type: string, format: uuid }
 *                         dueDay: { type: integer }
 *                         startDate: { type: string, format: date }
 *                         endDate: { type: string, format: date }
 *                         vendorId: { type: string, format: uuid }
 *                         createdAt: { type: string, format: date-time }
 *                         updatedAt: { type: string, format: date-time }
 *       400:
 *         description: "Missing or invalid fields."
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 */
const updateOperatingCost = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await OperatingCostService.updateOperatingCost(req.params.id as string, req.body);
    return handleSuccessResponse({ statusCode: successCode, result }, res, "Operating cost updated.");
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /operating-costs/{id}:
 *   delete:
 *     operationId: deleteOperatingCost
 *     summary: "Delete an operating cost"
 *     description: "**Who can call this:** admin (super_admin always allowed)."
 *     tags: ["Admin - Expenses & Operating Costs"]
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
const deleteOperatingCost = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await OperatingCostService.deleteOperatingCost(req.params.id as string);
    return handleSuccessResponse({ statusCode: successCode, result }, res, "Operating cost deleted.");
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

export const AdminExpensesController = {
  listExpenseCategories,
  createExpenseCategory,
  getExpenseCategory,
  updateExpenseCategory,
  deleteExpenseCategory,
  listExpenses,
  createExpense,
  getExpense,
  updateExpense,
  deleteExpense,
  approveExpense,
  uploadExpenseReceipt,
  listOperatingCosts,
  createOperatingCost,
  getMonthlyOperatingCost,
  getOperatingCost,
  updateOperatingCost,
  deleteOperatingCost,
};
