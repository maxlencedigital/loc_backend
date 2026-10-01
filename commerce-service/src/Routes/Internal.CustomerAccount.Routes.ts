import express from "express";
import { OrderInternalController } from "../Controllers/OrderInternal.Controller.js";
import { requireServiceCall } from "../Middleware/Identity.js";

const router = express.Router();

// Customer account, ordering and orders
// Service-to-service endpoints only: every path starts with /internal and is answered for
// another service (never a user). The gateway refuses to proxy /internal from outside.
router.use("/internal", requireServiceCall);

// "summary" is registered first so it is not taken for an order id.
router.get("/internal/orders/summary", OrderInternalController.summary);
router.get("/internal/orders/:id", OrderInternalController.getOrder);
router.post("/internal/orders/:id/payment-status", OrderInternalController.updatePaymentStatus);
router.post("/internal/orders/:id/status", OrderInternalController.changeStatus);

export default router;
