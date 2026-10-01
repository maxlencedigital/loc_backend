import { Response } from "express";
import { handleErrorResponse, handleSuccessResponse } from "../../commons/Response/Response.js";
import { created, successCode } from "../../commons/Utils/StatusCode.js";
import { IdentifiedRequest, RequestUser } from "../Middleware/Identity.js";
import { GarmentProfileService } from "../Services/GarmentProfile.Service.js";

/**
 * @openapi
 * /me/garment-profiles:
 *   get:
 *     operationId: listGarmentProfiles
 *     summary: "List garment profiles"
 *     description: "**Who can call this:** customer (super_admin always allowed)."
 *     tags: ["Customer - Garment Care Profiles"]
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
 *                               name: { type: string, description: "e.g. my navy suit" }
 *                               garmentTypeId: { type: string, format: uuid }
 *                               fabric: { type: string, enum: [cotton, linen, wool, silk, synthetic, blend, denim, leather, unknown] }
 *                               colour: { type: string }
 *                               brand: { type: string }
 *                               washInstructions: { type: array, items: { type: string } }
 *                               avoid: { type: array, items: { type: string }, description: "e.g. no tumble dry" }
 *                               notes: { type: string }
 *                               isFavourite: { type: boolean }
 *                               createdAt: { type: string, format: date-time }
 *                               updatedAt: { type: string, format: date-time }
 *                         page: { type: integer }
 *                         limit: { type: integer }
 *                         total: { type: integer }
 *       403:
 *         description: Your role is not allowed to call this.
 */
const listGarmentProfiles = async (req: IdentifiedRequest, res: Response) => {
  try {
    const user = req.user as RequestUser;
    const result = await GarmentProfileService.list(user, req.query);
    return handleSuccessResponse({ statusCode: successCode, result }, res, "Garment profiles.");
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /me/garment-profiles:
 *   post:
 *     operationId: createGarmentProfile
 *     summary: "Create a garment profile"
 *     description: "**Who can call this:** customer (super_admin always allowed)."
 *     tags: ["Customer - Garment Care Profiles"]
 *     x-roles: [customer]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               name: { type: string, description: "e.g. my navy suit" }
 *               garmentTypeId: { type: string, format: uuid }
 *               fabric: { type: string, enum: [cotton, linen, wool, silk, synthetic, blend, denim, leather, unknown] }
 *               colour: { type: string }
 *               brand: { type: string }
 *               washInstructions: { type: array, items: { type: string } }
 *               avoid: { type: array, items: { type: string }, description: "e.g. no tumble dry" }
 *               notes: { type: string }
 *               isFavourite: { type: boolean }
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
 *                         name: { type: string, description: "e.g. my navy suit" }
 *                         garmentTypeId: { type: string, format: uuid }
 *                         fabric: { type: string, enum: [cotton, linen, wool, silk, synthetic, blend, denim, leather, unknown] }
 *                         colour: { type: string }
 *                         brand: { type: string }
 *                         washInstructions: { type: array, items: { type: string } }
 *                         avoid: { type: array, items: { type: string }, description: "e.g. no tumble dry" }
 *                         notes: { type: string }
 *                         isFavourite: { type: boolean }
 *                         createdAt: { type: string, format: date-time }
 *                         updatedAt: { type: string, format: date-time }
 *       400:
 *         description: "Missing or invalid fields."
 *       403:
 *         description: Your role is not allowed to call this.
 */
const createGarmentProfile = async (req: IdentifiedRequest, res: Response) => {
  try {
    const user = req.user as RequestUser;
    const result = await GarmentProfileService.create(user, req.body);
    return handleSuccessResponse({ statusCode: created, result }, res, "Garment profile saved.");
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /me/garment-profiles/{id}:
 *   get:
 *     operationId: getGarmentProfile
 *     summary: "Get a garment profile"
 *     description: "**Who can call this:** customer (super_admin always allowed)."
 *     tags: ["Customer - Garment Care Profiles"]
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
 *                         name: { type: string, description: "e.g. my navy suit" }
 *                         garmentTypeId: { type: string, format: uuid }
 *                         fabric: { type: string, enum: [cotton, linen, wool, silk, synthetic, blend, denim, leather, unknown] }
 *                         colour: { type: string }
 *                         brand: { type: string }
 *                         washInstructions: { type: array, items: { type: string } }
 *                         avoid: { type: array, items: { type: string }, description: "e.g. no tumble dry" }
 *                         notes: { type: string }
 *                         isFavourite: { type: boolean }
 *                         createdAt: { type: string, format: date-time }
 *                         updatedAt: { type: string, format: date-time }
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 */
const getGarmentProfile = async (req: IdentifiedRequest, res: Response) => {
  try {
    const user = req.user as RequestUser;
    const result = await GarmentProfileService.get(user, req.params.id as string);
    return handleSuccessResponse({ statusCode: successCode, result }, res, "Garment profile.");
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /me/garment-profiles/{id}:
 *   patch:
 *     operationId: updateGarmentProfile
 *     summary: "Update a garment profile"
 *     description: "**Who can call this:** customer (super_admin always allowed)."
 *     tags: ["Customer - Garment Care Profiles"]
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
 *               name: { type: string, description: "e.g. my navy suit" }
 *               garmentTypeId: { type: string, format: uuid }
 *               fabric: { type: string, enum: [cotton, linen, wool, silk, synthetic, blend, denim, leather, unknown] }
 *               colour: { type: string }
 *               brand: { type: string }
 *               washInstructions: { type: array, items: { type: string } }
 *               avoid: { type: array, items: { type: string }, description: "e.g. no tumble dry" }
 *               notes: { type: string }
 *               isFavourite: { type: boolean }
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
 *                         name: { type: string, description: "e.g. my navy suit" }
 *                         garmentTypeId: { type: string, format: uuid }
 *                         fabric: { type: string, enum: [cotton, linen, wool, silk, synthetic, blend, denim, leather, unknown] }
 *                         colour: { type: string }
 *                         brand: { type: string }
 *                         washInstructions: { type: array, items: { type: string } }
 *                         avoid: { type: array, items: { type: string }, description: "e.g. no tumble dry" }
 *                         notes: { type: string }
 *                         isFavourite: { type: boolean }
 *                         createdAt: { type: string, format: date-time }
 *                         updatedAt: { type: string, format: date-time }
 *       400:
 *         description: "Missing or invalid fields."
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 */
const updateGarmentProfile = async (req: IdentifiedRequest, res: Response) => {
  try {
    const user = req.user as RequestUser;
    const result = await GarmentProfileService.update(user, req.params.id as string, req.body);
    return handleSuccessResponse({ statusCode: successCode, result }, res, "Garment profile updated.");
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /me/garment-profiles/{id}:
 *   delete:
 *     operationId: deleteGarmentProfile
 *     summary: "Delete a garment profile"
 *     description: "**Who can call this:** customer (super_admin always allowed)."
 *     tags: ["Customer - Garment Care Profiles"]
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
const deleteGarmentProfile = async (req: IdentifiedRequest, res: Response) => {
  try {
    const user = req.user as RequestUser;
    const result = await GarmentProfileService.remove(user, req.params.id as string);
    return handleSuccessResponse({ statusCode: successCode, result }, res, "Garment profile deleted.");
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /me/garment-profiles/{id}/history:
 *   get:
 *     operationId: getMyGarmentHistory
 *     summary: "Every store and order this garment has been through"
 *     description: "**Who can call this:** customer (super_admin always allowed)."
 *     tags: ["Customer - Garment Care Profiles"]
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
 *                         visits:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               orderId: { type: string, format: uuid }
 *                               storeId: { type: string, format: uuid }
 *                               storeName: { type: string }
 *                               date: { type: string, format: date }
 *                               service: { type: string }
 *                               careNotes: { type: string }
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 */
const getMyGarmentHistory = async (req: IdentifiedRequest, res: Response) => {
  try {
    const user = req.user as RequestUser;
    const result = await GarmentProfileService.history(user, req.params.id as string);
    return handleSuccessResponse({ statusCode: successCode, result }, res, "Garment history.");
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /me/garment-profiles/{id}/photo:
 *   post:
 *     operationId: uploadMyGarmentPhoto
 *     summary: "Attach a photo to a garment profile"
 *     description: "**Who can call this:** customer (super_admin always allowed). There is no file storage yet, so this takes a JSON reference to an image already hosted over https (up to 5 per profile) instead of a multipart upload."
 *     tags: ["Customer - Garment Care Profiles"]
 *     x-roles: [customer]
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
 *               url: { type: string, format: uri, description: "https link to the image" }
 *               note: { type: string }
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
const uploadMyGarmentPhoto = async (req: IdentifiedRequest, res: Response) => {
  try {
    const user = req.user as RequestUser;
    const result = await GarmentProfileService.addPhoto(user, req.params.id as string, req.body);
    return handleSuccessResponse({ statusCode: created, result }, res, "Photo added.");
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

export const CustomerGarmentProfilesController = {
  listGarmentProfiles,
  createGarmentProfile,
  getGarmentProfile,
  updateGarmentProfile,
  deleteGarmentProfile,
  getMyGarmentHistory,
  uploadMyGarmentPhoto,
};
