import { Request, Response } from "express";
import { handleErrorResponse, handleNotImplementedResponse } from "../../commons/Response/Response.js";
import { CustomException } from "../../commons/Exception/CustomException.js";
import { badRequest } from "../../commons/Utils/StatusCode.js";

const ALLOWED_CHANNELS = ["sms", "email", "whatsapp", "push"];

/**
 * @openapi
 * /notifications/send:
 *   post:
 *     summary: Send a notification through a given channel (admin/staff only)
 *     tags: ["Admin - Campaigns & Notifications"]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [recipientId, channel, templateId]
 *             properties:
 *               recipientId: { type: string }
 *               channel: { type: string, enum: [sms, email, whatsapp, push] }
 *               templateId: { type: string }
 *               params: { type: object, additionalProperties: true }
 *     responses:
 *       202:
 *         description: "Scaffolded per API contract — not yet implemented. Once wired up, returns: { notificationId: string, status: \"queued\" }."
 *       400:
 *         description: Missing or invalid fields.
 *       403:
 *         description: Authenticated but not admin/staff.
 *       501:
 *         description: Endpoint scaffolded per API contract — implementation pending.
 */
const send = async (req: Request, res: Response) => {
  try {
    const { recipientId, channel, templateId } = req.body;
    if (!recipientId || !templateId) {
      throw new CustomException("recipientId and templateId are required.", badRequest);
    }
    if (!channel || !ALLOWED_CHANNELS.includes(channel)) {
      throw new CustomException(`channel must be one of: ${ALLOWED_CHANNELS.join(", ")}.`, badRequest);
    }
    return handleNotImplementedResponse(res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

export const NotificationController = { send };
