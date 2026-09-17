import express from "express";
import { PaymentController } from "../Controllers/Payment.Controller.js";
import { requireIdentity, requireRole } from "../Middleware/Identity.js";

const router = express.Router();

// Called directly by the payment gateway itself — no gateway-issued
// identity headers are present on this request.
router.post("/payments/reconcile", PaymentController.reconcile);

router.get(
  "/payments/mismatches",
  requireIdentity,
  requireRole("admin", "staff"),
  PaymentController.listMismatches
);

export default router;
