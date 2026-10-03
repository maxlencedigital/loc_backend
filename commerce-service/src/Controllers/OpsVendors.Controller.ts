import { Response } from "express";
import { CustomException } from "../../commons/Exception/CustomException.js";
import { handleErrorResponse, handleSuccessResponse } from "../../commons/Response/Response.js";
import { created, successCode, unauthorized } from "../../commons/Utils/StatusCode.js";
import { IdentifiedRequest, RequestUser } from "../Middleware/Identity.js";
import { resolveStoreScope } from "../Middleware/StoreScope.js";
import { OpsPurchaseOrderService } from "../Services/OpsPurchaseOrder.Service.js";
import { OpsVendorService } from "../Services/OpsVendor.Service.js";

const userOf = (req: IdentifiedRequest): RequestUser => {
  if (!req.user) throw new CustomException("Authentication required.", unauthorized);
  return req.user;
};

/**
 * @openapi
 * /operations/materials:
 *   get:
 *     operationId: listMaterials
 *     summary: "List materials"
 *     description: "**Who can call this:** admin, hr, manager, staff (super_admin always allowed)."
 *     tags: ["Ops - Vendors & Purchasing"]
 *     x-roles: [admin, hr, manager, staff]
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
 *                               category: { type: string, enum: [detergent, softener, packaging, hangers, chemicals, other] }
 *                               unit: { type: string, description: "e.g. kg, litre, pack" }
 *                               reorderLevel: { type: number }
 *                               preferredVendorId: { type: string, format: uuid }
 *                               createdAt: { type: string, format: date-time }
 *                               updatedAt: { type: string, format: date-time }
 *                         page: { type: integer }
 *                         limit: { type: integer }
 *                         total: { type: integer }
 *       403:
 *         description: Your role is not allowed to call this.
 */
const listMaterials = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await OpsVendorService.listMaterials(req.query) }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /operations/materials:
 *   post:
 *     operationId: createMaterial
 *     summary: "Create a material"
 *     description: "**Who can call this:** admin, hr (super_admin always allowed)."
 *     tags: ["Ops - Vendors & Purchasing"]
 *     x-roles: [admin, hr]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, unit]
 *             properties:
 *               name: { type: string }
 *               category: { type: string, enum: [detergent, softener, packaging, hangers, chemicals, other] }
 *               unit: { type: string, description: "e.g. kg, litre, pack" }
 *               reorderLevel: { type: number }
 *               preferredVendorId: { type: string, format: uuid }
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
 *                         category: { type: string, enum: [detergent, softener, packaging, hangers, chemicals, other] }
 *                         unit: { type: string, description: "e.g. kg, litre, pack" }
 *                         reorderLevel: { type: number }
 *                         preferredVendorId: { type: string, format: uuid }
 *                         createdAt: { type: string, format: date-time }
 *                         updatedAt: { type: string, format: date-time }
 *       400:
 *         description: "Missing or invalid fields."
 *       409:
 *         description: "A material with this name already exists."
 *       403:
 *         description: Your role is not allowed to call this.
 */
const createMaterial = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: created, result: await OpsVendorService.createMaterial(req.body) }, res, "Material created.");
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /operations/materials/{id}:
 *   get:
 *     operationId: getMaterial
 *     summary: "Get a material"
 *     description: "**Who can call this:** admin, hr, manager, staff (super_admin always allowed)."
 *     tags: ["Ops - Vendors & Purchasing"]
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
 *                         id: { type: string, format: uuid }
 *                         name: { type: string }
 *                         category: { type: string, enum: [detergent, softener, packaging, hangers, chemicals, other] }
 *                         unit: { type: string, description: "e.g. kg, litre, pack" }
 *                         reorderLevel: { type: number }
 *                         preferredVendorId: { type: string, format: uuid }
 *                         createdAt: { type: string, format: date-time }
 *                         updatedAt: { type: string, format: date-time }
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 */
const getMaterial = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await OpsVendorService.getMaterial(req.params.id as string) }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /operations/materials/{id}:
 *   patch:
 *     operationId: updateMaterial
 *     summary: "Update a material"
 *     description: "**Who can call this:** admin, hr (super_admin always allowed)."
 *     tags: ["Ops - Vendors & Purchasing"]
 *     x-roles: [admin, hr]
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
 *               category: { type: string, enum: [detergent, softener, packaging, hangers, chemicals, other] }
 *               unit: { type: string, description: "e.g. kg, litre, pack" }
 *               reorderLevel: { type: number }
 *               preferredVendorId: { type: string, format: uuid }
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
 *                         category: { type: string, enum: [detergent, softener, packaging, hangers, chemicals, other] }
 *                         unit: { type: string, description: "e.g. kg, litre, pack" }
 *                         reorderLevel: { type: number }
 *                         preferredVendorId: { type: string, format: uuid }
 *                         createdAt: { type: string, format: date-time }
 *                         updatedAt: { type: string, format: date-time }
 *       400:
 *         description: "Missing or invalid fields."
 *       409:
 *         description: "A material with this name already exists."
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 */
const updateMaterial = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await OpsVendorService.updateMaterial(req.params.id as string, req.body) }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /operations/purchase/requirements:
 *   get:
 *     operationId: getPurchaseRequirements
 *     summary: "What is running low and what to order"
 *     description: "**Who can call this:** admin, hr, manager (super_admin always allowed)."
 *     tags: ["Ops - Vendors & Purchasing"]
 *     x-roles: [admin, hr, manager]
 *     parameters:
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
 *                         items:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               materialId: { type: string, format: uuid }
 *                               name: { type: string }
 *                               storeId: { type: string, format: uuid }
 *                               currentQty: { type: number }
 *                               reorderLevel: { type: number }
 *                               suggestedQty: { type: number }
 *                               preferredVendorId: { type: string, format: uuid }
 *       403:
 *         description: Your role is not allowed to call this.
 */
const getPurchaseRequirements = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await OpsPurchaseOrderService.requirements(resolveStoreScope(req), req.query) }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /operations/purchase/spend:
 *   get:
 *     operationId: getPurchaseSpend
 *     summary: "Spend per supplier"
 *     description: "**Who can call this:** admin, hr (super_admin always allowed)."
 *     tags: ["Ops - Vendors & Purchasing"]
 *     x-roles: [admin, hr]
 *     parameters:
 *       - in: query
 *         name: from
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: to
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: vendorId
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
 *                         byVendor:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               vendorId: { type: string, format: uuid }
 *                               name: { type: string }
 *                               spend: { type: number, description: "Amount in INR" }
 *       403:
 *         description: Your role is not allowed to call this.
 */
const getPurchaseSpend = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await OpsPurchaseOrderService.spend(resolveStoreScope(req), req.query) }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /operations/purchase-orders:
 *   post:
 *     operationId: createPurchaseOrder
 *     summary: "Raise a purchase order"
 *     description: "**Who can call this:** admin, hr (super_admin always allowed)."
 *     tags: ["Ops - Vendors & Purchasing"]
 *     x-roles: [admin, hr]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [vendorId, storeId, items]
 *             properties:
 *               vendorId: { type: string, format: uuid }
 *               storeId: { type: string, format: uuid }
 *               items:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required: [materialId, quantity]
 *                   properties:
 *                     materialId: { type: string, format: uuid }
 *                     quantity: { type: number }
 *                     unitPrice: { type: number, description: "Amount in INR" }
 *               expectedOn: { type: string, format: date }
 *               notes: { type: string }
 *     responses:
 *       201:
 *         description: "Created."
 *       400:
 *         description: "Missing or invalid fields."
 *       409:
 *         description: "The vendor is deactivated or the store is closed."
 *       403:
 *         description: Your role is not allowed to call this.
 */
const createPurchaseOrder = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: created, result: await OpsPurchaseOrderService.create(resolveStoreScope(req), userOf(req), req.body, req.header("idempotency-key")) }, res, "Purchase order created.");
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /operations/purchase-orders:
 *   get:
 *     operationId: listPurchaseOrders
 *     summary: "Purchase orders, including what is still outstanding"
 *     description: "**Who can call this:** admin, hr, manager (super_admin always allowed)."
 *     tags: ["Ops - Vendors & Purchasing"]
 *     x-roles: [admin, hr, manager]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, description: "1-based page number" }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, description: "page size, max 100" }
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [draft, sent, partially_received, received, cancelled] }
 *       - in: query
 *         name: vendorId
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: storeId
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: outstanding
 *         schema: { type: boolean, description: "sent or partially received only" }
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
 *                               vendorId: { type: string, format: uuid }
 *                               storeId: { type: string, format: uuid }
 *                               status: { type: string, enum: [draft, sent, partially_received, received, cancelled] }
 *                               total: { type: number, description: "Amount in INR" }
 *                               expectedOn: { type: string, format: date }
 *                         page: { type: integer }
 *                         limit: { type: integer }
 *                         total: { type: integer }
 *       403:
 *         description: Your role is not allowed to call this.
 */
const listPurchaseOrders = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await OpsPurchaseOrderService.list(resolveStoreScope(req), req.query) }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /operations/purchase-orders/{id}:
 *   get:
 *     operationId: getPurchaseOrder
 *     summary: "One purchase order"
 *     description: "**Who can call this:** admin, hr, manager (super_admin always allowed)."
 *     tags: ["Ops - Vendors & Purchasing"]
 *     x-roles: [admin, hr, manager]
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
const getPurchaseOrder = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await OpsPurchaseOrderService.getById(req.params.id as string, resolveStoreScope(req)) }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /operations/purchase-orders/{id}:
 *   patch:
 *     operationId: updatePurchaseOrder
 *     summary: "Edit a draft purchase order"
 *     description: "**Who can call this:** admin, hr (super_admin always allowed)."
 *     tags: ["Ops - Vendors & Purchasing"]
 *     x-roles: [admin, hr]
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
 *               items:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required: [materialId, quantity]
 *                   properties:
 *                     materialId: { type: string, format: uuid }
 *                     quantity: { type: number }
 *                     unitPrice: { type: number, description: "Amount in INR" }
 *               expectedOn: { type: string, format: date }
 *               notes: { type: string }
 *     responses:
 *       200:
 *         description: "OK."
 *       400:
 *         description: "Missing or invalid fields."
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 *       409:
 *         description: "Only a draft can be edited."
 */
const updatePurchaseOrder = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await OpsPurchaseOrderService.updateDraft(req.params.id as string, resolveStoreScope(req), req.body) }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /operations/purchase-orders/{id}/cancel:
 *   post:
 *     operationId: cancelPurchaseOrder
 *     summary: "Cancel a purchase order"
 *     description: "**Who can call this:** admin, hr (super_admin always allowed)."
 *     tags: ["Ops - Vendors & Purchasing"]
 *     x-roles: [admin, hr]
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
 *               reason: { type: string }
 *     responses:
 *       200:
 *         description: "OK."
 *       400:
 *         description: "Missing or invalid fields."
 *       409:
 *         description: "Only a draft or sent order can be cancelled."
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 */
const cancelPurchaseOrder = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await OpsPurchaseOrderService.cancel(req.params.id as string, resolveStoreScope(req), userOf(req), req.body) }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /operations/purchase-orders/{id}/receive:
 *   post:
 *     operationId: receivePurchaseOrder
 *     summary: "Record what arrived"
 *     description: "**Who can call this:** admin, hr, manager (super_admin always allowed). Partial deliveries are fine; the order stays outstanding until everything has arrived."
 *     tags: ["Ops - Vendors & Purchasing"]
 *     x-roles: [admin, hr, manager]
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
 *             required: [items]
 *             properties:
 *               items:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required: [materialId, receivedQty]
 *                   properties:
 *                     materialId: { type: string, format: uuid }
 *                     receivedQty: { type: number }
 *               invoiceRef: { type: string }
 *               note: { type: string }
 *     responses:
 *       200:
 *         description: "OK."
 *       400:
 *         description: "Missing or invalid fields."
 *       409:
 *         description: "The order is not sent or part-received, or more than the outstanding quantity was received."
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 */
const receivePurchaseOrder = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await OpsPurchaseOrderService.receive(req.params.id as string, resolveStoreScope(req), userOf(req), req.body) }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /operations/purchase-orders/{id}/send:
 *   post:
 *     operationId: sendPurchaseOrder
 *     summary: "Send the order to the vendor"
 *     description: "**Who can call this:** admin, hr (super_admin always allowed)."
 *     tags: ["Ops - Vendors & Purchasing"]
 *     x-roles: [admin, hr]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: "OK."
 *       409:
 *         description: "Only a draft can be sent; every line needs a price; the vendor must be active."
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 */
const sendPurchaseOrder = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await OpsPurchaseOrderService.send(req.params.id as string, resolveStoreScope(req), userOf(req)) }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /operations/vendors:
 *   get:
 *     operationId: listVendors
 *     summary: "List vendors"
 *     description: "**Who can call this:** admin, hr, manager (super_admin always allowed)."
 *     tags: ["Ops - Vendors & Purchasing"]
 *     x-roles: [admin, hr, manager]
 *     parameters:
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
 *         name: isActive
 *         schema: { type: boolean }
 *       - in: query
 *         name: q
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
 *                               category: { type: string, enum: [detergent, packaging, machinery, spares, it, services, other] }
 *                               contactName: { type: string }
 *                               phone: { type: string, description: "E.164 phone number, e.g. +919876543210" }
 *                               email: { type: string, format: email }
 *                               address: { type: string }
 *                               gstin: { type: string }
 *                               paymentTerms: { type: string }
 *                               isActive: { type: boolean }
 *                               createdAt: { type: string, format: date-time }
 *                               updatedAt: { type: string, format: date-time }
 *                         page: { type: integer }
 *                         limit: { type: integer }
 *                         total: { type: integer }
 *       403:
 *         description: Your role is not allowed to call this.
 */
const listVendors = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await OpsVendorService.listVendors(userOf(req), req.query) }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /operations/vendors:
 *   post:
 *     operationId: createVendor
 *     summary: "Create a vendor"
 *     description: "**Who can call this:** admin, hr (super_admin always allowed)."
 *     tags: ["Ops - Vendors & Purchasing"]
 *     x-roles: [admin, hr]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               name: { type: string }
 *               category: { type: string, enum: [detergent, packaging, machinery, spares, it, services, other] }
 *               contactName: { type: string }
 *               phone: { type: string, description: "E.164 phone number, e.g. +919876543210" }
 *               email: { type: string, format: email }
 *               address: { type: string }
 *               gstin: { type: string }
 *               paymentTerms: { type: string }
 *               isActive: { type: boolean }
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
 *                         category: { type: string, enum: [detergent, packaging, machinery, spares, it, services, other] }
 *                         contactName: { type: string }
 *                         phone: { type: string, description: "E.164 phone number, e.g. +919876543210" }
 *                         email: { type: string, format: email }
 *                         address: { type: string }
 *                         gstin: { type: string }
 *                         paymentTerms: { type: string }
 *                         isActive: { type: boolean }
 *                         createdAt: { type: string, format: date-time }
 *                         updatedAt: { type: string, format: date-time }
 *       400:
 *         description: "Missing or invalid fields."
 *       409:
 *         description: "A vendor with this GSTIN already exists."
 *       403:
 *         description: Your role is not allowed to call this.
 */
const createVendor = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: created, result: await OpsVendorService.createVendor(userOf(req), req.body) }, res, "Vendor created.");
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /operations/vendors/{id}:
 *   get:
 *     operationId: getVendor
 *     summary: "Get a vendor"
 *     description: "**Who can call this:** admin, hr, manager (super_admin always allowed)."
 *     tags: ["Ops - Vendors & Purchasing"]
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
 *                         category: { type: string, enum: [detergent, packaging, machinery, spares, it, services, other] }
 *                         contactName: { type: string }
 *                         phone: { type: string, description: "E.164 phone number, e.g. +919876543210" }
 *                         email: { type: string, format: email }
 *                         address: { type: string }
 *                         gstin: { type: string }
 *                         paymentTerms: { type: string }
 *                         isActive: { type: boolean }
 *                         createdAt: { type: string, format: date-time }
 *                         updatedAt: { type: string, format: date-time }
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 */
const getVendor = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await OpsVendorService.getVendor(req.params.id as string, userOf(req)) }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /operations/vendors/{id}:
 *   patch:
 *     operationId: updateVendor
 *     summary: "Update a vendor"
 *     description: "**Who can call this:** admin, hr (super_admin always allowed)."
 *     tags: ["Ops - Vendors & Purchasing"]
 *     x-roles: [admin, hr]
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
 *               category: { type: string, enum: [detergent, packaging, machinery, spares, it, services, other] }
 *               contactName: { type: string }
 *               phone: { type: string, description: "E.164 phone number, e.g. +919876543210" }
 *               email: { type: string, format: email }
 *               address: { type: string }
 *               gstin: { type: string }
 *               paymentTerms: { type: string }
 *               isActive: { type: boolean }
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
 *                         category: { type: string, enum: [detergent, packaging, machinery, spares, it, services, other] }
 *                         contactName: { type: string }
 *                         phone: { type: string, description: "E.164 phone number, e.g. +919876543210" }
 *                         email: { type: string, format: email }
 *                         address: { type: string }
 *                         gstin: { type: string }
 *                         paymentTerms: { type: string }
 *                         isActive: { type: boolean }
 *                         createdAt: { type: string, format: date-time }
 *                         updatedAt: { type: string, format: date-time }
 *       400:
 *         description: "Missing or invalid fields."
 *       409:
 *         description: "A vendor with this GSTIN already exists."
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 */
const updateVendor = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await OpsVendorService.updateVendor(req.params.id as string, userOf(req), req.body) }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /operations/vendors/{id}/agreements:
 *   post:
 *     operationId: createVendorAgreement
 *     summary: "Record an agreement with a vendor"
 *     description: "**Who can call this:** admin, hr (super_admin always allowed)."
 *     tags: ["Ops - Vendors & Purchasing"]
 *     x-roles: [admin, hr]
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
 *             required: [title, startDate]
 *             properties:
 *               title: { type: string }
 *               startDate: { type: string, format: date }
 *               endDate: { type: string, format: date }
 *               terms: { type: string }
 *     responses:
 *       201:
 *         description: "Created."
 *       400:
 *         description: "Missing or invalid fields."
 *       409:
 *         description: "The vendor is deactivated."
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 */
const createVendorAgreement = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: created, result: await OpsVendorService.createAgreement(req.params.id as string, userOf(req), req.body) }, res, "Agreement recorded.");
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /operations/vendors/{id}/agreements:
 *   get:
 *     operationId: listVendorAgreements
 *     summary: "A vendor's agreements"
 *     description: "**Who can call this:** admin, hr, manager (super_admin always allowed)."
 *     tags: ["Ops - Vendors & Purchasing"]
 *     x-roles: [admin, hr, manager]
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
 *                               title: { type: string }
 *                               startDate: { type: string, format: date }
 *                               endDate: { type: string, format: date }
 *                               terms: { type: string }
 *                               documentUrl: { type: string, format: uri }
 *                         page: { type: integer }
 *                         limit: { type: integer }
 *                         total: { type: integer }
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 */
const listVendorAgreements = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await OpsVendorService.listAgreements(req.params.id as string, req.query) }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /operations/vendors/{id}/agreements/{agreementId}/document:
 *   post:
 *     operationId: uploadVendorAgreementDocument
 *     summary: "Attach the signed agreement"
 *     description: "**Who can call this:** admin, hr (super_admin always allowed)."
 *     tags: ["Ops - Vendors & Purchasing"]
 *     x-roles: [admin, hr]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: agreementId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [url]
 *             properties:
 *               url: { type: string, format: uri, description: "https link to the file, which is kept elsewhere" }
 *               name: { type: string }
 *               contentType: { type: string, example: application/pdf }
 *               sizeBytes: { type: integer }
 *     responses:
 *       201:
 *         description: "Created."
 *       400:
 *         description: "Missing or invalid fields."
 *       409:
 *         description: "The agreement already holds 10 documents."
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 */
const uploadVendorAgreementDocument = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: created, result: await OpsVendorService.attachAgreementDocument(req.params.id as string, req.params.agreementId as string, userOf(req), req.body) }, res, "Document attached.");
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /operations/vendors/{id}/deactivate:
 *   post:
 *     operationId: deactivateVendor
 *     summary: "Stop using a vendor (history is kept)"
 *     description: "**Who can call this:** admin, hr (super_admin always allowed)."
 *     tags: ["Ops - Vendors & Purchasing"]
 *     x-roles: [admin, hr]
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
 *               reason: { type: string }
 *     responses:
 *       200:
 *         description: "OK."
 *       400:
 *         description: "Missing or invalid fields."
 *       409:
 *         description: "The vendor is already deactivated."
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 */
const deactivateVendor = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await OpsVendorService.deactivateVendor(req.params.id as string, userOf(req), req.body) }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /operations/vendors/{id}/history:
 *   get:
 *     operationId: getVendorHistory
 *     summary: "Orders, deliveries and spend with this vendor"
 *     description: "**Who can call this:** admin, hr, manager (super_admin always allowed)."
 *     tags: ["Ops - Vendors & Purchasing"]
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
 *                         orders: { type: integer }
 *                         onTimeDeliveryPct: { type: number }
 *                         totalSpend: { type: number, description: "Amount in INR" }
 *                         outstanding: { type: number, description: "Amount in INR" }
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 */
const getVendorHistory = async (req: IdentifiedRequest, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await OpsVendorService.getVendorHistory(req.params.id as string, resolveStoreScope(req), req.query) }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

export const OpsVendorsController = {
  listMaterials,
  createMaterial,
  getMaterial,
  updateMaterial,
  getPurchaseRequirements,
  getPurchaseSpend,
  createPurchaseOrder,
  listPurchaseOrders,
  getPurchaseOrder,
  updatePurchaseOrder,
  cancelPurchaseOrder,
  receivePurchaseOrder,
  sendPurchaseOrder,
  listVendors,
  createVendor,
  getVendor,
  updateVendor,
  createVendorAgreement,
  listVendorAgreements,
  uploadVendorAgreementDocument,
  deactivateVendor,
  getVendorHistory,
};
