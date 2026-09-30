// @generated-scaffold — contract scaffold from the API catalogue; handlers answer 501 until built.
// Once you implement a handler, delete the first line so regeneration can never overwrite your work.
import { Request, Response } from "express";
import { handleErrorResponse, handleNotImplementedResponse } from "../../commons/Response/Response.js";
import { requireFields } from "../../commons/Utils/Validation.js";

/**
 * @openapi
 * /rider/jobs/{id}/delivery/confirm:
 *   post:
 *     operationId: confirmDelivery
 *     summary: "Deliver the clean order and get the signature"
 *     description: "**Who can call this:** driver (super_admin always allowed)."
 *     tags: ["Rider - Delivery & Payment"]
 *     x-roles: [driver]
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
 *             required: [signature, receivedBy, itemCount]
 *             properties:
 *               signature: { type: string, description: "base64 image" }
 *               receivedBy: { type: string }
 *               itemCount: { type: integer }
 *               otp: { type: string }
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
 *       501:
 *         description: "Scaffolded per API contract — implementation pending."
 */
const confirmDelivery = async (req: Request, res: Response) => {
  try {
    requireFields(req.body, ["signature", "receivedBy", "itemCount"]);
    return handleNotImplementedResponse(res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /rider/jobs/{id}/delivery/photos:
 *   post:
 *     operationId: uploadDeliveryPhotos
 *     summary: "Photograph the delivery"
 *     description: "**Who can call this:** driver (super_admin always allowed). Multipart."
 *     tags: ["Rider - Delivery & Payment"]
 *     x-roles: [driver]
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
 *             required: [photo]
 *             properties:
 *               photo: { type: string, format: binary }
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
 *       501:
 *         description: "Scaffolded per API contract — implementation pending."
 */
const uploadDeliveryPhotos = async (_req: Request, res: Response) => {
  try {
    return handleNotImplementedResponse(res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /rider/jobs/{id}/payment:
 *   post:
 *     operationId: collectDoorPayment
 *     summary: "Take payment at the door for an order not paid online"
 *     description: "**Who can call this:** driver (super_admin always allowed). Recorded against the order; cash is settled with the store later."
 *     tags: ["Rider - Delivery & Payment"]
 *     x-roles: [driver]
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
 *             required: [method, amount]
 *             properties:
 *               method: { type: string, enum: [cash, upi, card] }
 *               amount: { type: number, description: "Amount in INR" }
 *               reference: { type: string }
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
 *         description: "The order is already paid."
 *       501:
 *         description: "Scaffolded per API contract — implementation pending."
 */
const collectDoorPayment = async (req: Request, res: Response) => {
  try {
    requireFields(req.body, ["method", "amount"]);
    return handleNotImplementedResponse(res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

export const RiderDeliveryController = {
  confirmDelivery,
  uploadDeliveryPhotos,
  collectDoorPayment,
};
