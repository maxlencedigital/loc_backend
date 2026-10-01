import { Response } from "express";
import { handleErrorResponse, handleSuccessResponse } from "../../commons/Response/Response.js";
import { created, successCode } from "../../commons/Utils/StatusCode.js";
import { IdentifiedRequest } from "../Middleware/Identity.js";
import { resolveStoreScope } from "../Middleware/StoreScope.js";
import { FabricRiskAdminService } from "../Services/FabricRiskAdmin.Service.js";
import { PricingService } from "../Services/Pricing.Service.js";

/**
 * @openapi
 * /areas/{id}/pricing:
 *   get:
 *     operationId: getAreaPricing
 *     summary: "An area's own pricing, where it differs from global"
 *     description: "**Who can call this:** admin, hr, manager (super_admin always allowed)."
 *     tags: ["Admin - Catalog & Pricing"]
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
 *                         overrides:
 *                           type: array
 *                           items:
 *                             type: object
 *                             required: [serviceId, garmentTypeId, price]
 *                             properties:
 *                               serviceId: { type: string, format: uuid }
 *                               garmentTypeId: { type: string, format: uuid }
 *                               price: { type: number, description: "Amount in INR" }
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 */
const getAreaPricing = async (req: IdentifiedRequest, res: Response) => {
  try {
    const scope = resolveStoreScope(req);
    const user = req.user as NonNullable<typeof req.user>;
    const result = await PricingService.getAreaPricing(scope, user, req.params.id);
    return handleSuccessResponse({ statusCode: successCode, result }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /areas/{id}/pricing:
 *   put:
 *     operationId: setAreaPricing
 *     summary: "Set an area's pricing overrides"
 *     description: "**Who can call this:** admin (super_admin always allowed)."
 *     tags: ["Admin - Catalog & Pricing"]
 *     x-roles: [admin]
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
 *             required: [overrides]
 *             properties:
 *               overrides:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required: [serviceId, garmentTypeId, price]
 *                   properties:
 *                     serviceId: { type: string, format: uuid }
 *                     garmentTypeId: { type: string, format: uuid }
 *                     price: { type: number, description: "Amount in INR" }
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
const setAreaPricing = async (req: IdentifiedRequest, res: Response) => {
  try {
    const scope = resolveStoreScope(req);
    const user = req.user as NonNullable<typeof req.user>;
    const result = await PricingService.setAreaPricing(scope, user, req.params.id, req.body);
    return handleSuccessResponse({ statusCode: successCode, result }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /fabric-risk-rules:
 *   post:
 *     operationId: createFabricRiskRule
 *     summary: "Create a fabric risk rule"
 *     description: "**Who can call this:** admin (super_admin always allowed)."
 *     tags: ["Admin - Catalog & Pricing"]
 *     x-roles: [admin]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [fabric, risk]
 *             properties:
 *               fabric: { type: string, enum: [cotton, linen, wool, silk, synthetic, blend, denim, leather, unknown] }
 *               risk: { type: string, enum: [low, medium, high] }
 *               handling: { type: string, description: "what staff should do differently" }
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
 *                         fabric: { type: string, enum: [cotton, linen, wool, silk, synthetic, blend, denim, leather, unknown] }
 *                         risk: { type: string, enum: [low, medium, high] }
 *                         handling: { type: string, description: "what staff should do differently" }
 *                         createdAt: { type: string, format: date-time }
 *                         updatedAt: { type: string, format: date-time }
 *       400:
 *         description: "Missing or invalid fields."
 *       403:
 *         description: Your role is not allowed to call this.
 */
const createFabricRiskRule = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await FabricRiskAdminService.create(req.body);
    return handleSuccessResponse({ statusCode: created, result }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /fabric-risk-rules/{id}:
 *   patch:
 *     operationId: updateFabricRiskRule
 *     summary: "Update a fabric risk rule"
 *     description: "**Who can call this:** admin (super_admin always allowed)."
 *     tags: ["Admin - Catalog & Pricing"]
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
 *               fabric: { type: string, enum: [cotton, linen, wool, silk, synthetic, blend, denim, leather, unknown] }
 *               risk: { type: string, enum: [low, medium, high] }
 *               handling: { type: string, description: "what staff should do differently" }
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
 *                         fabric: { type: string, enum: [cotton, linen, wool, silk, synthetic, blend, denim, leather, unknown] }
 *                         risk: { type: string, enum: [low, medium, high] }
 *                         handling: { type: string, description: "what staff should do differently" }
 *                         createdAt: { type: string, format: date-time }
 *                         updatedAt: { type: string, format: date-time }
 *       400:
 *         description: "Missing or invalid fields."
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 */
const updateFabricRiskRule = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await FabricRiskAdminService.update(req.params.id, req.body);
    return handleSuccessResponse({ statusCode: successCode, result }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /fabric-risk-rules/{id}:
 *   delete:
 *     operationId: deleteFabricRiskRule
 *     summary: "Delete a fabric risk rule"
 *     description: "**Who can call this:** admin (super_admin always allowed)."
 *     tags: ["Admin - Catalog & Pricing"]
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
const deleteFabricRiskRule = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await FabricRiskAdminService.remove(req.params.id);
    return handleSuccessResponse({ statusCode: successCode, result }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /pricing/effective:
 *   get:
 *     operationId: getEffectivePrice
 *     summary: "What a service costs at a store, and why"
 *     description: "**Who can call this:** admin, hr, manager (super_admin always allowed)."
 *     tags: ["Admin - Catalog & Pricing"]
 *     x-roles: [admin, hr, manager]
 *     parameters:
 *       - in: query
 *         name: storeId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: serviceId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: garmentTypeId
 *         required: true
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
 *                         price: { type: number, description: "Amount in INR" }
 *                         source: { type: string, enum: [global, area, store] }
 *       403:
 *         description: Your role is not allowed to call this.
 */
const getEffectivePrice = async (req: IdentifiedRequest, res: Response) => {
  try {
    const scope = resolveStoreScope(req);
    const result = await PricingService.getEffectivePrice(scope, req.query);
    return handleSuccessResponse({ statusCode: successCode, result }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /pricing/global:
 *   get:
 *     operationId: getGlobalPricing
 *     summary: "The business-wide price list"
 *     description: "**Who can call this:** admin, hr, manager (super_admin always allowed). Most things are priced once here; a business-wide change stays a single change."
 *     tags: ["Admin - Catalog & Pricing"]
 *     x-roles: [admin, hr, manager]
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
 *                             required: [serviceId, garmentTypeId, price]
 *                             properties:
 *                               serviceId: { type: string, format: uuid }
 *                               garmentTypeId: { type: string, format: uuid }
 *                               price: { type: number, description: "Amount in INR" }
 *                         effectiveFrom: { type: string, format: date }
 *       403:
 *         description: Your role is not allowed to call this.
 */
const getGlobalPricing = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await PricingService.getGlobalPricing();
    return handleSuccessResponse({ statusCode: successCode, result }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /pricing/global:
 *   put:
 *     operationId: setGlobalPricing
 *     summary: "Replace the business-wide price list"
 *     description: "**Who can call this:** admin (super_admin always allowed)."
 *     tags: ["Admin - Catalog & Pricing"]
 *     x-roles: [admin]
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
 *                   required: [serviceId, garmentTypeId, price]
 *                   properties:
 *                     serviceId: { type: string, format: uuid }
 *                     garmentTypeId: { type: string, format: uuid }
 *                     price: { type: number, description: "Amount in INR" }
 *               effectiveFrom: { type: string, format: date }
 *     responses:
 *       200:
 *         description: "OK."
 *       400:
 *         description: "Missing or invalid fields."
 *       403:
 *         description: Your role is not allowed to call this.
 */
const setGlobalPricing = async (req: IdentifiedRequest, res: Response) => {
  try {
    const user = req.user as NonNullable<typeof req.user>;
    const result = await PricingService.setGlobalPricing(user, req.body);
    return handleSuccessResponse({ statusCode: successCode, result }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /pricing/history:
 *   get:
 *     operationId: getPricingHistory
 *     summary: "Past changes to prices"
 *     description: "**Who can call this:** admin (super_admin always allowed)."
 *     tags: ["Admin - Catalog & Pricing"]
 *     x-roles: [admin]
 *     parameters:
 *       - in: query
 *         name: storeId
 *         schema: { type: string, format: uuid }
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
 *                         changes:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               at: { type: string, format: date-time }
 *                               by: { type: string }
 *                               scope: { type: string }
 *                               serviceId: { type: string, format: uuid }
 *                               garmentTypeId: { type: string, format: uuid }
 *                               from: { type: number, description: "Amount in INR" }
 *                               to: { type: number, description: "Amount in INR" }
 *       403:
 *         description: Your role is not allowed to call this.
 */
const getPricingHistory = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await PricingService.getPricingHistory(req.query);
    return handleSuccessResponse({ statusCode: successCode, result }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /stores/{id}/pricing:
 *   get:
 *     operationId: getStorePricing
 *     summary: "A store's own pricing, where it differs"
 *     description: "**Who can call this:** admin, hr, manager (super_admin always allowed). Anything not overridden simply follows the global (or area) price."
 *     tags: ["Admin - Catalog & Pricing"]
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
 *                         overrides:
 *                           type: array
 *                           items:
 *                             type: object
 *                             required: [serviceId, garmentTypeId, price]
 *                             properties:
 *                               id: { type: string, format: uuid }
 *                               serviceId: { type: string, format: uuid }
 *                               garmentTypeId: { type: string, format: uuid }
 *                               price: { type: number, description: "Amount in INR" }
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 */
const getStorePricing = async (req: IdentifiedRequest, res: Response) => {
  try {
    const scope = resolveStoreScope(req);
    const result = await PricingService.getStorePricing(scope, req.params.id);
    return handleSuccessResponse({ statusCode: successCode, result }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /stores/{id}/pricing:
 *   put:
 *     operationId: setStorePricing
 *     summary: "Set a store's pricing overrides"
 *     description: "**Who can call this:** admin (super_admin always allowed)."
 *     tags: ["Admin - Catalog & Pricing"]
 *     x-roles: [admin]
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
 *             required: [overrides]
 *             properties:
 *               overrides:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required: [serviceId, garmentTypeId, price]
 *                   properties:
 *                     serviceId: { type: string, format: uuid }
 *                     garmentTypeId: { type: string, format: uuid }
 *                     price: { type: number, description: "Amount in INR" }
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
const setStorePricing = async (req: IdentifiedRequest, res: Response) => {
  try {
    const scope = resolveStoreScope(req);
    const user = req.user as NonNullable<typeof req.user>;
    const result = await PricingService.setStorePricing(scope, user, req.params.id, req.body);
    return handleSuccessResponse({ statusCode: successCode, result }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /stores/{id}/pricing/{overrideId}:
 *   delete:
 *     operationId: removeStorePriceOverride
 *     summary: "Remove an override so the store follows the global price again"
 *     description: "**Who can call this:** admin (super_admin always allowed)."
 *     tags: ["Admin - Catalog & Pricing"]
 *     x-roles: [admin]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: overrideId
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
const removeStorePriceOverride = async (req: IdentifiedRequest, res: Response) => {
  try {
    const scope = resolveStoreScope(req);
    const user = req.user as NonNullable<typeof req.user>;
    const result = await PricingService.removeStorePriceOverride(scope, user, req.params.id, req.params.overrideId);
    return handleSuccessResponse({ statusCode: successCode, result }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

export const AdminPricingController = {
  getAreaPricing,
  setAreaPricing,
  createFabricRiskRule,
  updateFabricRiskRule,
  deleteFabricRiskRule,
  getEffectivePrice,
  getGlobalPricing,
  setGlobalPricing,
  getPricingHistory,
  getStorePricing,
  setStorePricing,
  removeStorePriceOverride,
};
