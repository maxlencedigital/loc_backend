import { Response } from "express";
import { handleErrorResponse, handleSuccessResponse } from "../../commons/Response/Response.js";
import { created, successCode } from "../../commons/Utils/StatusCode.js";
import { IdentifiedRequest, RequestUser } from "../Middleware/Identity.js";
import { CustomerProfileService } from "../Services/CustomerProfile.Service.js";

/**
 * @openapi
 * /me/addresses:
 *   get:
 *     operationId: listAddresses
 *     summary: "List addresses"
 *     description: "**Who can call this:** customer (super_admin always allowed)."
 *     tags: ["Customer - Profile & Addresses"]
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
 *                               label: { type: string, enum: [home, office, other] }
 *                               line1: { type: string }
 *                               line2: { type: string }
 *                               landmark: { type: string }
 *                               city: { type: string }
 *                               pincode: { type: string }
 *                               latitude: { type: number }
 *                               longitude: { type: number }
 *                               createdAt: { type: string, format: date-time }
 *                               updatedAt: { type: string, format: date-time }
 *                         page: { type: integer }
 *                         limit: { type: integer }
 *                         total: { type: integer }
 *       403:
 *         description: Your role is not allowed to call this.
 */
const listAddresses = async (req: IdentifiedRequest, res: Response) => {
  try {
    const user = req.user as RequestUser;
    const result = await CustomerProfileService.listAddresses(user, req.query);
    return handleSuccessResponse({ statusCode: successCode, result }, res, "Addresses.");
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /me/addresses:
 *   post:
 *     operationId: createAddress
 *     summary: "Create an address"
 *     description: "**Who can call this:** customer (super_admin always allowed)."
 *     tags: ["Customer - Profile & Addresses"]
 *     x-roles: [customer]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [label, line1, city, pincode]
 *             properties:
 *               label: { type: string, enum: [home, office, other] }
 *               line1: { type: string }
 *               line2: { type: string }
 *               landmark: { type: string }
 *               city: { type: string }
 *               pincode: { type: string }
 *               latitude: { type: number }
 *               longitude: { type: number }
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
 *                         label: { type: string, enum: [home, office, other] }
 *                         line1: { type: string }
 *                         line2: { type: string }
 *                         landmark: { type: string }
 *                         city: { type: string }
 *                         pincode: { type: string }
 *                         latitude: { type: number }
 *                         longitude: { type: number }
 *                         createdAt: { type: string, format: date-time }
 *                         updatedAt: { type: string, format: date-time }
 *       400:
 *         description: "Missing or invalid fields."
 *       403:
 *         description: Your role is not allowed to call this.
 */
const createAddress = async (req: IdentifiedRequest, res: Response) => {
  try {
    const user = req.user as RequestUser;
    const result = await CustomerProfileService.createAddress(user, req.body);
    return handleSuccessResponse({ statusCode: created, result }, res, "Address saved.");
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /me/addresses/{id}:
 *   get:
 *     operationId: getAddress
 *     summary: "Get an address"
 *     description: "**Who can call this:** customer (super_admin always allowed)."
 *     tags: ["Customer - Profile & Addresses"]
 *     x-roles: [customer]
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
 *                         label: { type: string, enum: [home, office, other] }
 *                         line1: { type: string }
 *                         line2: { type: string }
 *                         landmark: { type: string }
 *                         city: { type: string }
 *                         pincode: { type: string }
 *                         latitude: { type: number }
 *                         longitude: { type: number }
 *                         createdAt: { type: string, format: date-time }
 *                         updatedAt: { type: string, format: date-time }
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 */
const getAddress = async (req: IdentifiedRequest, res: Response) => {
  try {
    const user = req.user as RequestUser;
    const result = await CustomerProfileService.getAddress(user, req.params.id as string);
    return handleSuccessResponse({ statusCode: successCode, result }, res, "Address.");
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /me/addresses/{id}:
 *   patch:
 *     operationId: updateAddress
 *     summary: "Update an address"
 *     description: "**Who can call this:** customer (super_admin always allowed)."
 *     tags: ["Customer - Profile & Addresses"]
 *     x-roles: [customer]
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
 *               label: { type: string, enum: [home, office, other] }
 *               line1: { type: string }
 *               line2: { type: string }
 *               landmark: { type: string }
 *               city: { type: string }
 *               pincode: { type: string }
 *               latitude: { type: number }
 *               longitude: { type: number }
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
 *                         label: { type: string, enum: [home, office, other] }
 *                         line1: { type: string }
 *                         line2: { type: string }
 *                         landmark: { type: string }
 *                         city: { type: string }
 *                         pincode: { type: string }
 *                         latitude: { type: number }
 *                         longitude: { type: number }
 *                         createdAt: { type: string, format: date-time }
 *                         updatedAt: { type: string, format: date-time }
 *       400:
 *         description: "Missing or invalid fields."
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 */
const updateAddress = async (req: IdentifiedRequest, res: Response) => {
  try {
    const user = req.user as RequestUser;
    const result = await CustomerProfileService.updateAddress(user, req.params.id as string, req.body);
    return handleSuccessResponse({ statusCode: successCode, result }, res, "Address updated.");
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /me/addresses/{id}:
 *   delete:
 *     operationId: deleteAddress
 *     summary: "Delete an address"
 *     description: "**Who can call this:** customer (super_admin always allowed)."
 *     tags: ["Customer - Profile & Addresses"]
 *     x-roles: [customer]
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
const deleteAddress = async (req: IdentifiedRequest, res: Response) => {
  try {
    const user = req.user as RequestUser;
    const result = await CustomerProfileService.deleteAddress(user, req.params.id as string);
    return handleSuccessResponse({ statusCode: successCode, result }, res, "Address deleted.");
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /me/profile:
 *   get:
 *     operationId: getMyProfile
 *     summary: "Get my customer profile"
 *     description: "**Who can call this:** customer (super_admin always allowed)."
 *     tags: ["Customer - Profile & Addresses"]
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
 *                         id: { type: string, format: uuid }
 *                         name: { type: string }
 *                         phone: { type: string, description: "E.164 phone number, e.g. +919876543210" }
 *                         email: { type: string, format: email }
 *                         defaultAddressId: { type: string, format: uuid }
 *                         profileComplete: { type: boolean }
 *       403:
 *         description: Your role is not allowed to call this.
 */
const getMyProfile = async (req: IdentifiedRequest, res: Response) => {
  try {
    const user = req.user as RequestUser;
    const result = await CustomerProfileService.getProfile(user);
    return handleSuccessResponse({ statusCode: successCode, result }, res, "Profile.");
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /me/profile:
 *   patch:
 *     operationId: updateMyProfile
 *     summary: "Update my name, email or contact details"
 *     description: "**Who can call this:** customer (super_admin always allowed)."
 *     tags: ["Customer - Profile & Addresses"]
 *     x-roles: [customer]
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string }
 *               email: { type: string, format: email }
 *               defaultAddressId: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: "OK."
 *       400:
 *         description: "Missing or invalid fields."
 *       403:
 *         description: Your role is not allowed to call this.
 */
const updateMyProfile = async (req: IdentifiedRequest, res: Response) => {
  try {
    const user = req.user as RequestUser;
    const result = await CustomerProfileService.updateProfile(user, req.body);
    return handleSuccessResponse({ statusCode: successCode, result }, res, "Profile updated.");
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

export const CustomerProfileController = {
  listAddresses,
  createAddress,
  getAddress,
  updateAddress,
  deleteAddress,
  getMyProfile,
  updateMyProfile,
};
