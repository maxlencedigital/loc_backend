import { Response } from "express";
import { IdentifiedRequest } from "../Middleware/Identity.js";
import { requestActor } from "../Middleware/StoreScope.js";
import { handleErrorResponse, handleSuccessResponse } from "../../commons/Response/Response.js";
import { created, successCode } from "../../commons/Utils/StatusCode.js";
import { RiderDeliveryService } from "../Services/RiderDelivery.Service.js";

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
 *       409:
 *         description: "The request conflicts with the current state."
 *       400:
 *         description: "Missing or invalid fields."
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 */
const confirmDelivery = async (req: IdentifiedRequest, res: Response) => {
  try {
    const actor = requestActor(req);
    return handleSuccessResponse(
      { statusCode: successCode, result: await RiderDeliveryService.confirm(actor, req.params.id as string, req.body) },
      res
    );
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
 *     description: "**Who can call this:** driver (super_admin always allowed). Send JSON with an https link to the already-uploaded file; logistics has no file storage of its own."
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
 *             required: [photoUrl]
 *             properties:
 *               photoUrl: { type: string, format: uri, description: "https link to the uploaded photo" }
 *               caption: { type: string }
 *     responses:
 *       201:
 *         description: "Created."
 *       409:
 *         description: "The request conflicts with the current state."
 *       400:
 *         description: "Missing or invalid fields."
 *       403:
 *         description: Your role is not allowed to call this.
 *       404:
 *         description: Not found.
 */
const uploadDeliveryPhotos = async (req: IdentifiedRequest, res: Response) => {
  try {
    const actor = requestActor(req);
    return handleSuccessResponse(
      { statusCode: created, result: await RiderDeliveryService.photos(actor, req.params.id as string, req.body) },
      res
    );
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
 */
const collectDoorPayment = async (req: IdentifiedRequest, res: Response) => {
  try {
    const actor = requestActor(req);
    return handleSuccessResponse(
      { statusCode: successCode, result: await RiderDeliveryService.payment(actor, req.params.id as string, req.body, req.header("idempotency-key")?.trim() || null) },
      res
    );
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

export const RiderDeliveryController = {
  confirmDelivery,
  uploadDeliveryPhotos,
  collectDoorPayment,
};
