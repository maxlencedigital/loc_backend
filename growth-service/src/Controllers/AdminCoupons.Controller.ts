import { Response } from "express";
import { handleErrorResponse, handleSuccessResponse } from "../../commons/Response/Response.js";
import { created, successCode } from "../../commons/Utils/StatusCode.js";
import { IdentifiedRequest } from "../Middleware/Identity.js";
import { CouponService } from "../Services/Coupon.Service.js";
import { PackageService } from "../Services/Package.Service.js";
import { actorId } from "./Actor.js";

/**
 * @openapi
 * /coupons:
 *   get:
 *     operationId: listCoupons
 *     summary: "List coupons"
 *     description: "**Who can call this:** admin (super_admin always allowed)."
 *     tags: ["Admin - Coupons & Packages"]
 *     x-roles: [admin]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, description: "1-based page number" }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, description: "page size, max 100" }
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
 *                               code: { type: string }
 *                               title: { type: string }
 *                               type: { type: string, enum: [percent, flat, free_delivery] }
 *                               value: { type: number }
 *                               minOrderValue: { type: number, description: "Amount in INR" }
 *                               maxDiscount: { type: number, description: "Amount in INR" }
 *                               validFrom: { type: string, format: date }
 *                               validUntil: { type: string, format: date }
 *                               usageLimit: { type: integer }
 *                               perCustomerLimit: { type: integer }
 *                               storeIds: { type: array, items: { type: string, format: uuid } }
 *                               firstOrderOnly: { type: boolean }
 *                               isActive: { type: boolean }
 *                               createdAt: { type: string, format: date-time }
 *                               updatedAt: { type: string, format: date-time }
 *                         page: { type: integer }
 *                         limit: { type: integer }
 *                         total: { type: integer }
 *       403:
 *         description: Your role is not allowed to call this.
 */
const listCoupons = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await CouponService.list(req.query);
    return handleSuccessResponse({ statusCode: successCode, result }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /coupons:
 *   post:
 *     operationId: createCoupon
 *     summary: "Create a coupon"
 *     description: "**Who can call this:** admin (super_admin always allowed)."
 *     tags: ["Admin - Coupons & Packages"]
 *     x-roles: [admin]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [code, title, type, value, validFrom, validUntil]
 *             properties:
 *               code: { type: string }
 *               title: { type: string }
 *               type: { type: string, enum: [percent, flat, free_delivery] }
 *               value: { type: number }
 *               minOrderValue: { type: number, description: "Amount in INR" }
 *               maxDiscount: { type: number, description: "Amount in INR" }
 *               validFrom: { type: string, format: date }
 *               validUntil: { type: string, format: date }
 *               usageLimit: { type: integer }
 *               perCustomerLimit: { type: integer }
 *               storeIds: { type: array, items: { type: string, format: uuid } }
 *               firstOrderOnly: { type: boolean }
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
 *                         code: { type: string }
 *                         title: { type: string }
 *                         type: { type: string, enum: [percent, flat, free_delivery] }
 *                         value: { type: number }
 *                         minOrderValue: { type: number, description: "Amount in INR" }
 *                         maxDiscount: { type: number, description: "Amount in INR" }
 *                         validFrom: { type: string, format: date }
 *                         validUntil: { type: string, format: date }
 *                         usageLimit: { type: integer }
 *                         perCustomerLimit: { type: integer }
 *                         storeIds: { type: array, items: { type: string, format: uuid } }
 *                         firstOrderOnly: { type: boolean }
 *                         isActive: { type: boolean }
 *                         createdAt: { type: string, format: date-time }
 *                         updatedAt: { type: string, format: date-time }
 *       400:
 *         description: "Missing or invalid fields."
 *       403:
 *         description: Your role is not allowed to call this.
 */
const createCoupon = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await CouponService.create(req.body);
    return handleSuccessResponse({ statusCode: created, result }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /coupons/{id}:
 *   get:
 *     operationId: getCoupon
 *     summary: "Get a coupon"
 *     description: "**Who can call this:** admin (super_admin always allowed)."
 *     tags: ["Admin - Coupons & Packages"]
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
 *                         code: { type: string }
 *                         title: { type: string }
 *                         type: { type: string, enum: [percent, flat, free_delivery] }
 *                         value: { type: number }
 *                         minOrderValue: { type: number, description: "Amount in INR" }
 *                         maxDiscount: { type: number, description: "Amount in INR" }
 *                         validFrom: { type: string, format: date }
 *                         validUntil: { type: string, format: date }
 *                         usageLimit: { type: integer }
 *                         perCustomerLimit: { type: integer }
 *                         storeIds: { type: array, items: { type: string, format: uuid } }
 *                         firstOrderOnly: { type: boolean }
 *                         isActive: { type: boolean }
 *                         createdAt: { type: string, format: date-time }
 *                         updatedAt: { type: string, format: date-time }
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 */
const getCoupon = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await CouponService.get(req.params.id);
    return handleSuccessResponse({ statusCode: successCode, result }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /coupons/{id}:
 *   patch:
 *     operationId: updateCoupon
 *     summary: "Update a coupon"
 *     description: "**Who can call this:** admin (super_admin always allowed)."
 *     tags: ["Admin - Coupons & Packages"]
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
 *               code: { type: string }
 *               title: { type: string }
 *               type: { type: string, enum: [percent, flat, free_delivery] }
 *               value: { type: number }
 *               minOrderValue: { type: number, description: "Amount in INR" }
 *               maxDiscount: { type: number, description: "Amount in INR" }
 *               validFrom: { type: string, format: date }
 *               validUntil: { type: string, format: date }
 *               usageLimit: { type: integer }
 *               perCustomerLimit: { type: integer }
 *               storeIds: { type: array, items: { type: string, format: uuid } }
 *               firstOrderOnly: { type: boolean }
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
 *                         code: { type: string }
 *                         title: { type: string }
 *                         type: { type: string, enum: [percent, flat, free_delivery] }
 *                         value: { type: number }
 *                         minOrderValue: { type: number, description: "Amount in INR" }
 *                         maxDiscount: { type: number, description: "Amount in INR" }
 *                         validFrom: { type: string, format: date }
 *                         validUntil: { type: string, format: date }
 *                         usageLimit: { type: integer }
 *                         perCustomerLimit: { type: integer }
 *                         storeIds: { type: array, items: { type: string, format: uuid } }
 *                         firstOrderOnly: { type: boolean }
 *                         isActive: { type: boolean }
 *                         createdAt: { type: string, format: date-time }
 *                         updatedAt: { type: string, format: date-time }
 *       400:
 *         description: "Missing or invalid fields."
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 */
const updateCoupon = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await CouponService.update(req.params.id, req.body);
    return handleSuccessResponse({ statusCode: successCode, result }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /coupons/{id}/deactivate:
 *   post:
 *     operationId: deactivateCoupon
 *     summary: "Stop a coupon being used"
 *     description: "**Who can call this:** admin (super_admin always allowed)."
 *     tags: ["Admin - Coupons & Packages"]
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
const deactivateCoupon = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await CouponService.deactivate(req.params.id);
    return handleSuccessResponse({ statusCode: successCode, result }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /coupons/{id}/usage:
 *   get:
 *     operationId: getCouponUsage
 *     summary: "How often a coupon was used and what it cost"
 *     description: "**Who can call this:** admin (super_admin always allowed)."
 *     tags: ["Admin - Coupons & Packages"]
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
 *                         redemptions: { type: integer }
 *                         totalDiscount: { type: number, description: "Amount in INR" }
 *                         uniqueCustomers: { type: integer }
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 */
const getCouponUsage = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await CouponService.usage(req.params.id);
    return handleSuccessResponse({ statusCode: successCode, result }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /customer-packages:
 *   get:
 *     operationId: listCustomerPackages
 *     summary: "Packages customers have bought"
 *     description: "**Who can call this:** admin (super_admin always allowed)."
 *     tags: ["Admin - Coupons & Packages"]
 *     x-roles: [admin]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, description: "1-based page number" }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, description: "page size, max 100" }
 *       - in: query
 *         name: customerId
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [active, exhausted, expired] }
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
 *                               customerId: { type: string, format: uuid }
 *                               packageId: { type: string, format: uuid }
 *                               remainingCredit: { type: number, description: "Amount in INR" }
 *                               status: { type: string }
 *                         page: { type: integer }
 *                         limit: { type: integer }
 *                         total: { type: integer }
 *       403:
 *         description: Your role is not allowed to call this.
 */
const listCustomerPackages = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await PackageService.listCustomerPackages(req.query);
    return handleSuccessResponse({ statusCode: successCode, result }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /customer-packages/{id}:
 *   get:
 *     operationId: getCustomerPackage
 *     summary: "One customer's package"
 *     description: "**Who can call this:** admin (super_admin always allowed)."
 *     tags: ["Admin - Coupons & Packages"]
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
const getCustomerPackage = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await PackageService.getCustomerPackage(req.params.id);
    return handleSuccessResponse({ statusCode: successCode, result }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /packages:
 *   get:
 *     operationId: listPrepaidPackages
 *     summary: "List prepaid packages"
 *     description: "**Who can call this:** admin, manager (super_admin always allowed)."
 *     tags: ["Admin - Coupons & Packages"]
 *     x-roles: [admin, manager]
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
 *                               price: { type: number, description: "Amount in INR" }
 *                               credit: { type: number, description: "Amount in INR" }
 *                               validityDays: { type: integer }
 *                               description: { type: string }
 *                               isActive: { type: boolean }
 *                               createdAt: { type: string, format: date-time }
 *                               updatedAt: { type: string, format: date-time }
 *                         page: { type: integer }
 *                         limit: { type: integer }
 *                         total: { type: integer }
 *       403:
 *         description: Your role is not allowed to call this.
 */
const listPrepaidPackages = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await PackageService.listPackages(req.query);
    return handleSuccessResponse({ statusCode: successCode, result }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /packages:
 *   post:
 *     operationId: createPrepaidPackage
 *     summary: "Create a prepaid package"
 *     description: "**Who can call this:** admin (super_admin always allowed)."
 *     tags: ["Admin - Coupons & Packages"]
 *     x-roles: [admin]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, price, credit, validityDays]
 *             properties:
 *               name: { type: string }
 *               price: { type: number, description: "Amount in INR" }
 *               credit: { type: number, description: "Amount in INR" }
 *               validityDays: { type: integer }
 *               description: { type: string }
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
 *                         price: { type: number, description: "Amount in INR" }
 *                         credit: { type: number, description: "Amount in INR" }
 *                         validityDays: { type: integer }
 *                         description: { type: string }
 *                         isActive: { type: boolean }
 *                         createdAt: { type: string, format: date-time }
 *                         updatedAt: { type: string, format: date-time }
 *       400:
 *         description: "Missing or invalid fields."
 *       403:
 *         description: Your role is not allowed to call this.
 */
const createPrepaidPackage = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await PackageService.createPackage(req.body);
    return handleSuccessResponse({ statusCode: created, result }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /packages/{id}:
 *   get:
 *     operationId: getPrepaidPackage
 *     summary: "Get a prepaid package"
 *     description: "**Who can call this:** admin, manager (super_admin always allowed)."
 *     tags: ["Admin - Coupons & Packages"]
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
 *                         name: { type: string }
 *                         price: { type: number, description: "Amount in INR" }
 *                         credit: { type: number, description: "Amount in INR" }
 *                         validityDays: { type: integer }
 *                         description: { type: string }
 *                         isActive: { type: boolean }
 *                         createdAt: { type: string, format: date-time }
 *                         updatedAt: { type: string, format: date-time }
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 */
const getPrepaidPackage = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await PackageService.getPackage(req.params.id);
    return handleSuccessResponse({ statusCode: successCode, result }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /packages/{id}:
 *   patch:
 *     operationId: updatePrepaidPackage
 *     summary: "Update a prepaid package"
 *     description: "**Who can call this:** admin (super_admin always allowed)."
 *     tags: ["Admin - Coupons & Packages"]
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
 *               price: { type: number, description: "Amount in INR" }
 *               credit: { type: number, description: "Amount in INR" }
 *               validityDays: { type: integer }
 *               description: { type: string }
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
 *                         price: { type: number, description: "Amount in INR" }
 *                         credit: { type: number, description: "Amount in INR" }
 *                         validityDays: { type: integer }
 *                         description: { type: string }
 *                         isActive: { type: boolean }
 *                         createdAt: { type: string, format: date-time }
 *                         updatedAt: { type: string, format: date-time }
 *       400:
 *         description: "Missing or invalid fields."
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 */
const updatePrepaidPackage = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await PackageService.updatePackage(req.params.id, req.body);
    return handleSuccessResponse({ statusCode: successCode, result }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /packages/{id}/subscribers:
 *   get:
 *     operationId: listPackageSubscribers
 *     summary: "Who holds a package"
 *     description: "**Who can call this:** admin (super_admin always allowed)."
 *     tags: ["Admin - Coupons & Packages"]
 *     x-roles: [admin]
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
 *                               customerId: { type: string, format: uuid }
 *                               name: { type: string }
 *                               remainingCredit: { type: number, description: "Amount in INR" }
 *                               expiresOn: { type: string, format: date }
 *                         page: { type: integer }
 *                         limit: { type: integer }
 *                         total: { type: integer }
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 */
const listPackageSubscribers = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await PackageService.listSubscribers(req.params.id, req.query);
    return handleSuccessResponse({ statusCode: successCode, result }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

export const AdminCouponsController = {
  listCoupons,
  createCoupon,
  getCoupon,
  updateCoupon,
  deactivateCoupon,
  getCouponUsage,
  listCustomerPackages,
  getCustomerPackage,
  listPrepaidPackages,
  createPrepaidPackage,
  getPrepaidPackage,
  updatePrepaidPackage,
  listPackageSubscribers,
};
