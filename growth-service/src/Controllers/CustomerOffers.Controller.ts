import { Response } from "express";
import { handleErrorResponse, handleSuccessResponse } from "../../commons/Response/Response.js";
import { successCode } from "../../commons/Utils/StatusCode.js";
import { IdentifiedRequest } from "../Middleware/Identity.js";
import { CouponService } from "../Services/Coupon.Service.js";
import { LoyaltyService } from "../Services/Loyalty.Service.js";
import { PackageService } from "../Services/Package.Service.js";
import { actorId } from "./Actor.js";

/**
 * @openapi
 * /me/coupons:
 *   get:
 *     operationId: listMyCoupons
 *     summary: "Coupons I can use"
 *     description: "**Who can call this:** customer (super_admin always allowed)."
 *     tags: ["Customer - Offers & Loyalty"]
 *     x-roles: [customer]
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
 *                               code: { type: string }
 *                               title: { type: string }
 *                               type: { type: string, enum: [percent, flat, free_delivery] }
 *                               value: { type: number }
 *                               minOrderValue: { type: number, description: "Amount in INR" }
 *                               validUntil: { type: string, format: date }
 *                         page: { type: integer }
 *                         limit: { type: integer }
 *                         total: { type: integer }
 *       403:
 *         description: Your role is not allowed to call this.
 */
const listMyCoupons = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await CouponService.listMine(actorId(req), req.query);
    return handleSuccessResponse({ statusCode: successCode, result }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /me/coupons/validate:
 *   post:
 *     operationId: validateMyCoupon
 *     summary: "Would this coupon work on this order?"
 *     description: "**Who can call this:** customer (super_admin always allowed)."
 *     tags: ["Customer - Offers & Loyalty"]
 *     x-roles: [customer]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [code]
 *             properties:
 *               code: { type: string }
 *               orderValue: { type: number, description: "Amount in INR" }
 *               storeId: { type: string, format: uuid }
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
 *                         valid: { type: boolean }
 *                         discount: { type: number, description: "Amount in INR" }
 *                         reason: { type: string }
 *       400:
 *         description: "Missing or invalid fields."
 *       429:
 *         description: "Too many coupon checks. Limited to 20 per 10 minutes per customer."
 *       403:
 *         description: Your role is not allowed to call this.
 */
const validateMyCoupon = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await CouponService.validateMine(actorId(req), req.body);
    return handleSuccessResponse({ statusCode: successCode, result }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /me/loyalty:
 *   get:
 *     operationId: getMyLoyalty
 *     summary: "My points and tier"
 *     description: "**Who can call this:** customer (super_admin always allowed)."
 *     tags: ["Customer - Offers & Loyalty"]
 *     x-roles: [customer]
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
 *                         points: { type: integer }
 *                         tier: { type: string }
 *                         nextTier: { type: string }
 *                         pointsToNextTier: { type: integer }
 *       403:
 *         description: Your role is not allowed to call this.
 */
const getMyLoyalty = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await LoyaltyService.getMine(actorId(req));
    return handleSuccessResponse({ statusCode: successCode, result }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /me/loyalty/redeem:
 *   post:
 *     operationId: redeemMyPoints
 *     summary: "Spend points on an order"
 *     description: "**Who can call this:** customer (super_admin always allowed)."
 *     tags: ["Customer - Offers & Loyalty"]
 *     x-roles: [customer]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [points]
 *             properties:
 *               points: { type: integer }
 *               orderId: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: "OK."
 *       400:
 *         description: "Missing or invalid fields."
 *       403:
 *         description: Your role is not allowed to call this.
 *       409:
 *         description: "Not enough points."
 */
const redeemMyPoints = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await LoyaltyService.redeemMine(actorId(req), req.body);
    return handleSuccessResponse({ statusCode: successCode, result }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /me/loyalty/transactions:
 *   get:
 *     operationId: listMyLoyaltyTransactions
 *     summary: "How I earned and spent points"
 *     description: "**Who can call this:** customer (super_admin always allowed)."
 *     tags: ["Customer - Offers & Loyalty"]
 *     x-roles: [customer]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, description: "1-based page number" }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, description: "page size, max 100" }
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
 *                               points: { type: integer }
 *                               reason: { type: string }
 *                               orderId: { type: string, format: uuid }
 *                               at: { type: string, format: date-time }
 *                         page: { type: integer }
 *                         limit: { type: integer }
 *                         total: { type: integer }
 *       403:
 *         description: Your role is not allowed to call this.
 */
const listMyLoyaltyTransactions = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await LoyaltyService.listMyTransactions(actorId(req), req.query);
    return handleSuccessResponse({ statusCode: successCode, result }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /me/packages/available:
 *   get:
 *     operationId: listAvailablePackages
 *     summary: "Prepaid packages I can buy"
 *     description: "**Who can call this:** customer (super_admin always allowed)."
 *     tags: ["Customer - Offers & Loyalty"]
 *     x-roles: [customer]
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
 *                         page: { type: integer }
 *                         limit: { type: integer }
 *                         total: { type: integer }
 *       403:
 *         description: Your role is not allowed to call this.
 */
const listAvailablePackages = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await PackageService.listAvailable(req.query);
    return handleSuccessResponse({ statusCode: successCode, result }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /me/packages/owned:
 *   get:
 *     operationId: listMyPackages
 *     summary: "Packages I have bought and what is left on each"
 *     description: "**Who can call this:** customer (super_admin always allowed)."
 *     tags: ["Customer - Offers & Loyalty"]
 *     x-roles: [customer]
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
 *                               packageId: { type: string, format: uuid }
 *                               name: { type: string }
 *                               remainingCredit: { type: number, description: "Amount in INR" }
 *                               expiresOn: { type: string, format: date }
 *                         page: { type: integer }
 *                         limit: { type: integer }
 *                         total: { type: integer }
 *       403:
 *         description: Your role is not allowed to call this.
 */
const listMyPackages = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await PackageService.listOwned(actorId(req), req.query);
    return handleSuccessResponse({ statusCode: successCode, result }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /me/packages/{packageId}/purchase:
 *   post:
 *     operationId: purchaseMyPackage
 *     summary: "Buy a prepaid package"
 *     description: "**Who can call this:** customer (super_admin always allowed)."
 *     tags: ["Customer - Offers & Loyalty"]
 *     x-roles: [customer]
 *     parameters:
 *       - in: path
 *         name: packageId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               paymentMethod: { type: string, enum: [online, saved_method] }
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
 *                         razorpayOrderId: { type: string }
 *                         amount: { type: number, description: "Amount in INR" }
 *                         currency: { type: string }
 *       400:
 *         description: "Missing or invalid fields."
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 */
const purchaseMyPackage = async (req: IdentifiedRequest, res: Response) => {
  try {
    const result = await PackageService.purchase(actorId(req), req.params.packageId, req.body);
    return handleSuccessResponse({ statusCode: successCode, result }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

export const CustomerOffersController = {
  listMyCoupons,
  validateMyCoupon,
  getMyLoyalty,
  redeemMyPoints,
  listMyLoyaltyTransactions,
  listAvailablePackages,
  listMyPackages,
  purchaseMyPackage,
};
