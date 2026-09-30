// @generated-scaffold — contract scaffold from the API catalogue; handlers answer 501 until built.
// Once you implement a handler, delete the first line so regeneration can never overwrite your work.
import express from "express";
import { AdminCouponsController } from "../Controllers/AdminCoupons.Controller.js";
import { requireIdentity, requireRole } from "../Middleware/Identity.js";

const router = express.Router();

const asAdmin = [requireIdentity, requireRole("admin")];
const asManager = [requireIdentity, requireRole("admin", "manager")];

router.get("/coupons", ...asAdmin, AdminCouponsController.listCoupons);
router.post("/coupons", ...asAdmin, AdminCouponsController.createCoupon);
router.get("/coupons/:id", ...asAdmin, AdminCouponsController.getCoupon);
router.patch("/coupons/:id", ...asAdmin, AdminCouponsController.updateCoupon);
router.post("/coupons/:id/deactivate", ...asAdmin, AdminCouponsController.deactivateCoupon);
router.get("/coupons/:id/usage", ...asAdmin, AdminCouponsController.getCouponUsage);
router.get("/customer-packages", ...asAdmin, AdminCouponsController.listCustomerPackages);
router.get("/customer-packages/:id", ...asAdmin, AdminCouponsController.getCustomerPackage);
router.get("/packages", ...asManager, AdminCouponsController.listPrepaidPackages);
router.post("/packages", ...asAdmin, AdminCouponsController.createPrepaidPackage);
router.get("/packages/:id", ...asManager, AdminCouponsController.getPrepaidPackage);
router.patch("/packages/:id", ...asAdmin, AdminCouponsController.updatePrepaidPackage);
router.get("/packages/:id/subscribers", ...asAdmin, AdminCouponsController.listPackageSubscribers);

export default router;
