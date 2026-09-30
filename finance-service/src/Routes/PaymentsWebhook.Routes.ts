// @generated-scaffold — contract scaffold from the API catalogue; handlers answer 501 until built.
// Once you implement a handler, delete the first line so regeneration can never overwrite your work.
import express from "express";
import { PaymentsWebhookController } from "../Controllers/PaymentsWebhook.Controller.js";

const router = express.Router();

router.post("/public/payments/reconcile", PaymentsWebhookController.receiveRazorpayWebhook);

export default router;
