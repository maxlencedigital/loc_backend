import { Response } from "express";
import { handleErrorResponse, handleSuccessResponse } from "../../commons/Response/Response.js";
import { created, successCode } from "../../commons/Utils/StatusCode.js";
import { IdentifiedRequest, RequestUser } from "../Middleware/Identity.js";
import { resolveStoreScope } from "../Middleware/StoreScope.js";
import { ComplianceService } from "../Services/Compliance.Service.js";

/**
 * @openapi
 * /operations/compliance/expiring:
 *   get:
 *     operationId: listExpiringCompliance
 *     summary: "What expires soon, with time to act"
 *     description: "**Who can call this:** admin, hr, manager (super_admin always allowed)."
 *     tags: ["Ops - Compliance"]
 *     x-roles: [admin, hr, manager]
 *     parameters:
 *       - in: query
 *         name: withinDays
 *         schema: { type: integer }
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
 *                               id: { type: string, format: uuid }
 *                               name: { type: string }
 *                               type: { type: string }
 *                               expiresOn: { type: string, format: date }
 *                               daysLeft: { type: integer }
 *       403:
 *         description: Your role is not allowed to call this.
 */
const listExpiringCompliance = async (req: IdentifiedRequest, res: Response) => {
  try {
    const scope = resolveStoreScope(req);
    const result = await ComplianceService.expiring(scope, req.query);
    return handleSuccessResponse({ statusCode: successCode, result }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /operations/compliance/items:
 *   get:
 *     operationId: listComplianceItems
 *     summary: "List compliance items"
 *     description: "**Who can call this:** admin, hr, manager (super_admin always allowed)."
 *     tags: ["Ops - Compliance"]
 *     x-roles: [admin, hr, manager]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, description: "1-based page number" }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, description: "page size, max 100" }
 *       - in: query
 *         name: type
 *         schema: { type: string }
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [valid, expiring, expired] }
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
 *                               id: { type: string, format: uuid }
 *                               name: { type: string }
 *                               type: { type: string, enum: [licence, registration, certificate, permit, other] }
 *                               authority: { type: string }
 *                               referenceNumber: { type: string }
 *                               issuedOn: { type: string, format: date }
 *                               expiresOn: { type: string, format: date }
 *                               storeId: { type: string, format: uuid }
 *                               ownerId: { type: string, format: uuid }
 *                               status: { type: string, enum: [valid, expiring, expired] }
 *                               createdAt: { type: string, format: date-time }
 *                               updatedAt: { type: string, format: date-time }
 *                         page: { type: integer }
 *                         limit: { type: integer }
 *                         total: { type: integer }
 *       403:
 *         description: Your role is not allowed to call this.
 */
const listComplianceItems = async (req: IdentifiedRequest, res: Response) => {
  try {
    const scope = resolveStoreScope(req);
    const result = await ComplianceService.list(scope, req.query);
    return handleSuccessResponse({ statusCode: successCode, result }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /operations/compliance/items:
 *   post:
 *     operationId: createComplianceItem
 *     summary: "Create a compliance item"
 *     description: "**Who can call this:** admin, hr (super_admin always allowed)."
 *     tags: ["Ops - Compliance"]
 *     x-roles: [admin, hr]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, type, expiresOn]
 *             properties:
 *               name: { type: string }
 *               type: { type: string, enum: [licence, registration, certificate, permit, other] }
 *               authority: { type: string }
 *               referenceNumber: { type: string }
 *               issuedOn: { type: string, format: date }
 *               expiresOn: { type: string, format: date }
 *               storeId: { type: string, format: uuid }
 *               ownerId: { type: string, format: uuid }
 *               status: { type: string, enum: [valid, expiring, expired] }
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
 *                         type: { type: string, enum: [licence, registration, certificate, permit, other] }
 *                         authority: { type: string }
 *                         referenceNumber: { type: string }
 *                         issuedOn: { type: string, format: date }
 *                         expiresOn: { type: string, format: date }
 *                         storeId: { type: string, format: uuid }
 *                         ownerId: { type: string, format: uuid }
 *                         status: { type: string, enum: [valid, expiring, expired] }
 *                         createdAt: { type: string, format: date-time }
 *                         updatedAt: { type: string, format: date-time }
 *       400:
 *         description: "Missing or invalid fields."
 *       403:
 *         description: Your role is not allowed to call this.
 */
const createComplianceItem = async (req: IdentifiedRequest, res: Response) => {
  try {
    const scope = resolveStoreScope(req);
    const user = req.user as RequestUser;
    const result = await ComplianceService.create(scope, user, req.body);
    return handleSuccessResponse({ statusCode: created, result }, res, "Compliance item created.");
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /operations/compliance/items/{id}:
 *   get:
 *     operationId: getComplianceItem
 *     summary: "Get a compliance item"
 *     description: "**Who can call this:** admin, hr, manager (super_admin always allowed)."
 *     tags: ["Ops - Compliance"]
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
 *                         type: { type: string, enum: [licence, registration, certificate, permit, other] }
 *                         authority: { type: string }
 *                         referenceNumber: { type: string }
 *                         issuedOn: { type: string, format: date }
 *                         expiresOn: { type: string, format: date }
 *                         storeId: { type: string, format: uuid }
 *                         ownerId: { type: string, format: uuid }
 *                         status: { type: string, enum: [valid, expiring, expired] }
 *                         createdAt: { type: string, format: date-time }
 *                         updatedAt: { type: string, format: date-time }
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 */
const getComplianceItem = async (req: IdentifiedRequest, res: Response) => {
  try {
    const scope = resolveStoreScope(req);
    const result = await ComplianceService.getById(req.params.id, scope);
    return handleSuccessResponse({ statusCode: successCode, result }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /operations/compliance/items/{id}:
 *   patch:
 *     operationId: updateComplianceItem
 *     summary: "Update a compliance item"
 *     description: "**Who can call this:** admin, hr (super_admin always allowed)."
 *     tags: ["Ops - Compliance"]
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
 *               type: { type: string, enum: [licence, registration, certificate, permit, other] }
 *               authority: { type: string }
 *               referenceNumber: { type: string }
 *               issuedOn: { type: string, format: date }
 *               expiresOn: { type: string, format: date }
 *               storeId: { type: string, format: uuid }
 *               ownerId: { type: string, format: uuid }
 *               status: { type: string, enum: [valid, expiring, expired] }
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
 *                         type: { type: string, enum: [licence, registration, certificate, permit, other] }
 *                         authority: { type: string }
 *                         referenceNumber: { type: string }
 *                         issuedOn: { type: string, format: date }
 *                         expiresOn: { type: string, format: date }
 *                         storeId: { type: string, format: uuid }
 *                         ownerId: { type: string, format: uuid }
 *                         status: { type: string, enum: [valid, expiring, expired] }
 *                         createdAt: { type: string, format: date-time }
 *                         updatedAt: { type: string, format: date-time }
 *       400:
 *         description: "Missing or invalid fields."
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 */
const updateComplianceItem = async (req: IdentifiedRequest, res: Response) => {
  try {
    const scope = resolveStoreScope(req);
    const user = req.user as RequestUser;
    const result = await ComplianceService.update(req.params.id, scope, user, req.body);
    return handleSuccessResponse({ statusCode: successCode, result }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /operations/compliance/items/{id}/checklist:
 *   get:
 *     operationId: getComplianceChecklist
 *     summary: "What has to be in place for this item"
 *     description: "**Who can call this:** admin, hr, manager (super_admin always allowed)."
 *     tags: ["Ops - Compliance"]
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
 *                         items:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               title: { type: string }
 *                               done: { type: boolean }
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 */
const getComplianceChecklist = async (req: IdentifiedRequest, res: Response) => {
  try {
    const scope = resolveStoreScope(req);
    const result = await ComplianceService.getChecklist(req.params.id, scope);
    return handleSuccessResponse({ statusCode: successCode, result }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /operations/compliance/items/{id}/checklist:
 *   put:
 *     operationId: setComplianceChecklist
 *     summary: "Set this item's checklist"
 *     description: "**Who can call this:** admin, hr (super_admin always allowed)."
 *     tags: ["Ops - Compliance"]
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
 *             required: [items]
 *             properties:
 *               items:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required: [title]
 *                   properties:
 *                     title: { type: string }
 *                     done: { type: boolean }
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
const setComplianceChecklist = async (req: IdentifiedRequest, res: Response) => {
  try {
    const scope = resolveStoreScope(req);
    const user = req.user as RequestUser;
    const result = await ComplianceService.setChecklist(req.params.id, scope, user, req.body);
    return handleSuccessResponse({ statusCode: successCode, result }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /operations/compliance/items/{id}/documents:
 *   post:
 *     operationId: uploadComplianceDocument
 *     summary: "Attach a document (an https link plus metadata, at most 20 per item)"
 *     description: "**Who can call this:** admin, hr (super_admin always allowed)."
 *     tags: ["Ops - Compliance"]
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
 *             required: [url]
 *             properties:
 *               url: { type: string, description: "https link to the document, kept elsewhere; no file is stored here" }
 *               name: { type: string }
 *               contentType: { type: string }
 *               caption: { type: string }
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
const uploadComplianceDocument = async (req: IdentifiedRequest, res: Response) => {
  try {
    const scope = resolveStoreScope(req);
    const user = req.user as RequestUser;
    const result = await ComplianceService.addDocument(req.params.id, scope, user, req.body);
    return handleSuccessResponse({ statusCode: created, result }, res, "Document attached.");
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /operations/compliance/items/{id}/renew:
 *   post:
 *     operationId: renewComplianceItem
 *     summary: "Renew a licence or certificate"
 *     description: "**Who can call this:** admin, hr (super_admin always allowed)."
 *     tags: ["Ops - Compliance"]
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
 *             required: [newExpiresOn]
 *             properties:
 *               newExpiresOn: { type: string, format: date }
 *               referenceNumber: { type: string }
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
const renewComplianceItem = async (req: IdentifiedRequest, res: Response) => {
  try {
    const scope = resolveStoreScope(req);
    const user = req.user as RequestUser;
    const result = await ComplianceService.renew(req.params.id, scope, user, req.body);
    return handleSuccessResponse({ statusCode: successCode, result }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /operations/compliance/summary:
 *   get:
 *     operationId: getComplianceSummary
 *     summary: "What state every licence and certificate is in"
 *     description: "**Who can call this:** admin, hr, manager (super_admin always allowed)."
 *     tags: ["Ops - Compliance"]
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
 *                         total: { type: integer }
 *                         valid: { type: integer }
 *                         expiringSoon: { type: integer }
 *                         expired: { type: integer }
 *       403:
 *         description: Your role is not allowed to call this.
 */
const getComplianceSummary = async (req: IdentifiedRequest, res: Response) => {
  try {
    const scope = resolveStoreScope(req);
    const result = await ComplianceService.summary(scope, req.query);
    return handleSuccessResponse({ statusCode: successCode, result }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

export const OpsComplianceController = {
  listExpiringCompliance,
  listComplianceItems,
  createComplianceItem,
  getComplianceItem,
  updateComplianceItem,
  getComplianceChecklist,
  setComplianceChecklist,
  uploadComplianceDocument,
  renewComplianceItem,
  getComplianceSummary,
};
