import express from "express";
import { PaymentController } from "../Controllers/Payment.Controller.js";
import { requireIdentity, requireRole } from "../Middleware/Identity.js";

const router = express.Router();

router.post(
  "/payments/orders",
  requireIdentity,
  requireRole("admin", "manager", "staff"),
  PaymentController.createOrder
);
router.post(
  "/payments/verify",
  requireIdentity,
  requireRole("admin", "manager", "staff", "customer"),
  PaymentController.verify
);
router.get(
  "/payments/mismatches",
  requireIdentity,
  requireRole("admin", "staff"),
  PaymentController.listMismatches
);

export default router;
