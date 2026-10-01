import express from "express";
import { InternalController } from "../Controllers/Internal.Controller.js";
import { requireServiceCall } from "../Middleware/Identity.js";

const router = express.Router();

// Growth service internal API.
// Service-to-service endpoints only: every path starts with /internal and is answered for
// another service (never a user). The gateway refuses to proxy /internal from outside.
router.use("/internal", requireServiceCall);

router.post("/internal/notifications/dispatch", InternalController.dispatchNotification);
router.post("/internal/coupons/validate", InternalController.validateCoupon);
router.post("/internal/coupons/redeem", InternalController.redeemCoupon);
router.post("/internal/loyalty/earn", InternalController.earnPoints);
router.post("/internal/loyalty/expire", InternalController.expirePoints);
router.post("/internal/packages/activate", InternalController.activatePackage);

export default router;
