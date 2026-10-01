import express from "express";
import { InternalController } from "../Controllers/Internal.Controller.js";
import { requireServiceCall } from "../Middleware/Identity.js";

const router = express.Router();

// Finance service internal API.
// Service-to-service endpoints only: every path starts with /internal and is answered for
// another service (never a user). The gateway refuses to proxy /internal from outside.
router.use("/internal", requireServiceCall);

// Agreed contract (the commerce checkout calls these).
router.get("/internal/payments", InternalController.listPayments);
router.post("/internal/payments/orders", InternalController.createPaymentOrder);
router.post("/internal/payments/verify", InternalController.verifyPayment);

// Additions: the catalogue has no write path for receivables or store cash, so commerce reports
// them here. Listed in the P11 module note for the integrator.
router.post("/internal/receivables", InternalController.registerReceivable);
router.post("/internal/cash/day-close", InternalController.registerDayClose);
router.post("/internal/cash/deposits", InternalController.registerDeposit);

export default router;
