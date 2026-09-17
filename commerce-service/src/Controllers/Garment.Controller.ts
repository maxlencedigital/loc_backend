import { Request, Response } from "express";
import { handleErrorResponse, handleNotImplementedResponse } from "../../commons/Response/Response.js";
import { CustomException } from "../../commons/Exception/CustomException.js";
import { badRequest } from "../../commons/Utils/StatusCode.js";

/**
 * @openapi
 * /garments/{tagId}/scan:
 *   post:
 *     summary: Scan a garment's QR tag to record an in/out tracking event
 *     tags: [Garments]
 *     parameters:
 *       - in: path
 *         name: tagId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [location, action]
 *             properties:
 *               location: { type: string }
 *               action: { type: string, enum: [in, out] }
 *     responses:
 *       200:
 *         description: Scan recorded.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 result:
 *                   type: object
 *                   properties:
 *                     tagId: { type: string }
 *                     itemId: { type: string }
 *                     location: { type: string }
 *                     action: { type: string }
 *                     scannedAt: { type: string, format: date-time }
 *       400:
 *         description: Missing required fields.
 *       404:
 *         description: Tag not found.
 *       501:
 *         description: Scaffolded per API contract — implementation pending.
 */
const scan = async (req: Request, res: Response) => {
  try {
    const { location, action } = req.body ?? {};
    if (!location || !action) {
      throw new CustomException("location and action are required.", badRequest);
    }
    if (action !== "in" && action !== "out") {
      throw new CustomException('action must be "in" or "out".', badRequest);
    }
    return handleNotImplementedResponse(res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /garments/{id}/image:
 *   post:
 *     summary: Attach a captured image to a garment/order item
 *     tags: [Garments]
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
 *             required: [file]
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *     responses:
 *       201:
 *         description: Image stored.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 result:
 *                   type: object
 *                   properties:
 *                     imageUrl: { type: string }
 *       400:
 *         description: Missing file.
 *       404:
 *         description: Garment/order item not found.
 *       501:
 *         description: Scaffolded per API contract — implementation pending.
 */
const uploadImage = async (_req: Request, res: Response) => {
  // Multipart parsing (multer or equivalent) isn't wired up yet — that's
  // part of the pending implementation, not something to validate here.
  return handleNotImplementedResponse(res);
};

export const GarmentController = { scan, uploadImage };
