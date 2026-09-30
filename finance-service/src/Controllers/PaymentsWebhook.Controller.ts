import { Request, Response } from "express";
import { handleErrorResponse, handleSuccessResponse } from "../../commons/Response/Response.js";
import { PaymentService } from "../Services/Payment.Service.js";
import { successCode } from "../../commons/Utils/StatusCode.js";
import { RawBodyRequest } from "../Middleware/RawBody.js";

/**
 * @openapi
 * /public/payments/reconcile:
 *   post:
 *     operationId: receiveRazorpayWebhook
 *     summary: "Razorpay payment events (payment.authorized, payment.captured, payment.failed, refund.processed)"
 *     description: "**Public** — no token required. Called by Razorpay, not by an app. Public because Razorpay sends no token; it authenticates by signature instead. Delivery is at-least-once and can arrive out of order, so every event is recorded by Razorpay's own event id and a repeat is ignored. Register https://<gateway>/finance/public/payments/reconcile in the Razorpay dashboard."
 *     tags: ["Admin - Payments & Reconciliation"]
 *     security: []
 *     parameters:
 *       - in: header
 *         name: X-Razorpay-Signature
 *         required: true
 *         schema: { type: string, description: "HMAC-SHA256 of the raw body; the request is rejected if it does not verify" }
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               event: { type: string, description: "e.g. payment.captured" }
 *               payload: { type: object }
 *     responses:
 *       200:
 *         description: "Event accepted, or already seen (a replay)."
 *       400:
 *         description: "Missing or invalid signature."
 *       503:
 *         description: "Webhook secret is not configured on the server."
 */
// A valid event always gets 200, even a replay or an unknown order: any other
// answer only makes Razorpay retry it for days.
const receiveRazorpayWebhook = async (req: RawBodyRequest, res: Response) => {
  try {
    const result = await PaymentService.handleWebhook(
      req.rawBody,
      req.header("x-razorpay-signature"),
      req.header("x-razorpay-event-id")
    );
    return handleSuccessResponse({ statusCode: successCode, result }, res, "Event accepted.");
  } catch (error) {
    return handleErrorResponse(error, res);
  }
};

export const PaymentsWebhookController = {
  receiveRazorpayWebhook,
};
