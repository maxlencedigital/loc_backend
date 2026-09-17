import { Request, Response } from "express";
import { IdentifiedRequest } from "../Middleware/Identity.js";
import { handleNotImplementedResponse } from "../../commons/Response/Response.js";

/**
 * @openapi
 * /payments/reconcile:
 *   post:
 *     summary: Payment gateway webhook receiver
 *     description: >
 *       Called directly by the payment gateway, not routed through the
 *       API gateway — carries no Bearer token. The real implementation
 *       must verify the gateway's webhook signature header before
 *       trusting this payload and matching it against Order.paymentId;
 *       that verification and matching logic is not yet wired up.
 *     tags: [Payments]
 *     security: []
 *     requestBody:
 *       required: true
 *       description: Raw webhook payload — exact shape depends on which payment gateway is chosen.
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             additionalProperties: true
 *     responses:
 *       200:
 *         description: Webhook accepted for processing.
 */
const reconcile = async (_req: Request, res: Response) => {
  return handleNotImplementedResponse(
    res,
    "Payment reconciliation webhook scaffolded — signature verification and matching logic pending."
  );
};

/**
 * @openapi
 * /payments/mismatches:
 *   get:
 *     summary: List payments flagged for manual review (admin/staff only)
 *     description: >
 *       Payments where a gateway settlement amount didn't match the
 *       corresponding Order.paymentId, flagged for manual review.
 *     tags: [Payments]
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [open, resolved] }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *     responses:
 *       200:
 *         description: >
 *           Paginated list of flagged payment mismatches, each shaped as
 *           { id, orderId, expectedAmount, gatewayAmount, gatewayTransactionId, flaggedAt, status }.
 *       403:
 *         description: Authenticated but not admin/staff.
 */
const listMismatches = async (_req: IdentifiedRequest, res: Response) => {
  return handleNotImplementedResponse(
    res,
    "Payment mismatch listing scaffolded — reconciliation matching logic pending."
  );
};

export const PaymentController = { reconcile, listMismatches };
