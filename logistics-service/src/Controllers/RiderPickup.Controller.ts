import { Response } from "express";
import { IdentifiedRequest } from "../Middleware/Identity.js";
import { requestActor } from "../Middleware/StoreScope.js";
import { handleErrorResponse, handleSuccessResponse } from "../../commons/Response/Response.js";
import { created, successCode } from "../../commons/Utils/StatusCode.js";
import { RiderPickupService } from "../Services/RiderPickup.Service.js";

/**
 * @openapi
 * /rider/jobs/{id}/handoff:
 *   post:
 *     operationId: handOffToStore
 *     summary: "Drop the collected garments at the store"
 *     description: "**Who can call this:** driver (super_admin always allowed)."
 *     tags: ["Rider - Pickup"]
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
 *             required: [storeId, itemCount]
 *             properties:
 *               storeId: { type: string, format: uuid }
 *               itemCount: { type: integer }
 *               receiverId: { type: string, format: uuid }
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
 *         description: "The store's count does not match."
 */
const handOffToStore = async (req: IdentifiedRequest, res: Response) => {
  try {
    const actor = requestActor(req);
    return handleSuccessResponse(
      { statusCode: successCode, result: await RiderPickupService.handOff(actor, req.params.id as string, req.body) },
      res
    );
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /rider/jobs/{id}/pickup/confirm:
 *   post:
 *     operationId: confirmPickup
 *     summary: "Get the customer's confirmation on my screen"
 *     description: "**Who can call this:** driver (super_admin always allowed). So there is a clear record the handover happened."
 *     tags: ["Rider - Pickup"]
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
 *             required: [itemCount, confirmation]
 *             properties:
 *               itemCount: { type: integer }
 *               confirmation: { type: string, enum: [otp, signature] }
 *               otp: { type: string }
 *               signature: { type: string, description: "base64 image" }
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
const confirmPickup = async (req: IdentifiedRequest, res: Response) => {
  try {
    const actor = requestActor(req);
    return handleSuccessResponse(
      { statusCode: successCode, result: await RiderPickupService.confirm(actor, req.params.id as string, req.body) },
      res
    );
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /rider/jobs/{id}/pickup/inspection:
 *   post:
 *     operationId: recordPickupInspection
 *     summary: "Note what I can see before a delicate or premium item leaves the customer's hands"
 *     description: "**Who can call this:** driver (super_admin always allowed). Turns a possible later dispute into a settled question with a note, a photo and a timestamp."
 *     tags: ["Rider - Pickup"]
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
 *             required: [items]
 *             properties:
 *               items:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required: [itemId, condition]
 *                   properties:
 *                     itemId: { type: string, format: uuid }
 *                     condition: { type: string, enum: [ok, stain, tear, loose_button, colour_fade, damaged, other] }
 *                     note: { type: string }
 *               overallNote: { type: string }
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
const recordPickupInspection = async (req: IdentifiedRequest, res: Response) => {
  try {
    const actor = requestActor(req);
    return handleSuccessResponse(
      { statusCode: successCode, result: await RiderPickupService.inspection(actor, req.params.id as string, req.body) },
      res
    );
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /rider/jobs/{id}/pickup/photos:
 *   post:
 *     operationId: uploadPickupPhotos
 *     summary: "Photograph an item at the door"
 *     description: "**Who can call this:** driver (super_admin always allowed). Send JSON with an https link to the already-uploaded file; logistics has no file storage of its own."
 *     tags: ["Rider - Pickup"]
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
 *               itemId: { type: string, format: uuid }
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
const uploadPickupPhotos = async (req: IdentifiedRequest, res: Response) => {
  try {
    const actor = requestActor(req);
    return handleSuccessResponse(
      { statusCode: created, result: await RiderPickupService.photos(actor, req.params.id as string, req.body) },
      res
    );
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /rider/jobs/{id}/pickup/scan:
 *   post:
 *     operationId: scanPickupItem
 *     summary: "Scan a garment's tag as I collect it (a normal pickup)"
 *     description: "**Who can call this:** driver (super_admin always allowed). Quick: scan, collect, confirm. Nothing more is needed for a normal order."
 *     tags: ["Rider - Pickup"]
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
 *             required: [tagId]
 *             properties:
 *               tagId: { type: string }
 *               condition: { type: string, enum: [ok, stain, tear, loose_button, colour_fade, damaged, other] }
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
const scanPickupItem = async (req: IdentifiedRequest, res: Response) => {
  try {
    const actor = requestActor(req);
    return handleSuccessResponse(
      { statusCode: successCode, result: await RiderPickupService.scan(actor, req.params.id as string, req.body) },
      res
    );
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

export const RiderPickupController = {
  handOffToStore,
  confirmPickup,
  recordPickupInspection,
  uploadPickupPhotos,
  scanPickupItem,
};
