import { Request, Response } from "express";
import { handleErrorResponse, handleSuccessResponse } from "../../commons/Response/Response.js";
import { successCode } from "../../commons/Utils/StatusCode.js";
import { ComplaintService } from "../Services/Complaint.Service.js";
import { TicketService } from "../Services/Ticket.Service.js";

/**
 * @openapi
 * /internal/support-tickets/{id}/messages:
 *   post:
 *     operationId: internalSupportTicketReply
 *     summary: "A support agent replies on a customer's ticket (service to service)"
 *     description: "Internal. The ticket becomes answered and firstResponseAt is stamped the first time. A closed ticket accepts nothing (409). A malformed id is 400."
 *     tags: ["Internal - Support"]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [message, authorUserId, authorName]
 *             properties:
 *               message: { type: string, maxLength: 2000 }
 *               authorUserId: { type: string, format: uuid }
 *               authorName: { type: string, maxLength: 80 }
 *     responses:
 *       200:
 *         description: "OK."
 *       400:
 *         description: "Invalid fields."
 *       404:
 *         description: "Ticket not found."
 *       409:
 *         description: "The ticket is closed or full."
 */
const replyToTicket = async (req: Request, res: Response) => {
  try {
    return handleSuccessResponse(
      { statusCode: successCode, result: await TicketService.supportReply(req.params.id as string, req.body) },
      res
    );
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /internal/support-tickets/{id}/close:
 *   post:
 *     operationId: internalSupportTicketClose
 *     summary: "Close a customer's ticket (service to service)"
 *     description: "Internal. Idempotent: closing a closed ticket changes nothing. A malformed id is 400."
 *     tags: ["Internal - Support"]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: "OK."
 *       400:
 *         description: "Malformed id."
 *       404:
 *         description: "Ticket not found."
 */
const closeTicket = async (req: Request, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await TicketService.close(req.params.id as string) }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

/**
 * @openapi
 * /internal/complaints/close-resolved:
 *   post:
 *     operationId: internalCloseResolvedComplaints
 *     summary: "Close resolved complaints nobody has challenged (service to service)"
 *     description: "Internal, for a scheduler. Closes up to `limit` complaints resolved more than `olderThanDays` days ago, oldest first, and returns how many. Safe to repeat."
 *     tags: ["Internal - Support"]
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               olderThanDays: { type: integer, minimum: 1, maximum: 365, default: 7 }
 *               limit: { type: integer, minimum: 1, maximum: 500, default: 200 }
 *     responses:
 *       200:
 *         description: "OK. { closed: number }"
 *       400:
 *         description: "Invalid fields."
 */
const closeResolvedComplaints = async (req: Request, res: Response) => {
  try {
    return handleSuccessResponse({ statusCode: successCode, result: await ComplaintService.closeResolved(req.body) }, res);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

export const SupportInternalController = { replyToTicket, closeTicket, closeResolvedComplaints };
