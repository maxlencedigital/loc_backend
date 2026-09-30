// @generated-scaffold — contract scaffold from the API catalogue; handlers answer 501 until built.
// Once you implement a handler, delete the first line so regeneration can never overwrite your work.
import express from "express";
import { AdminPricingController } from "../Controllers/AdminPricing.Controller.js";
import { requireIdentity, requireRole } from "../Middleware/Identity.js";

const router = express.Router();

const asHrOrManager = [requireIdentity, requireRole("admin", "hr", "manager")];
const asAdmin = [requireIdentity, requireRole("admin")];

router.get("/areas/:id/pricing", ...asHrOrManager, AdminPricingController.getAreaPricing);
router.put("/areas/:id/pricing", ...asAdmin, AdminPricingController.setAreaPricing);
router.post("/fabric-risk-rules", ...asAdmin, AdminPricingController.createFabricRiskRule);
router.patch("/fabric-risk-rules/:id", ...asAdmin, AdminPricingController.updateFabricRiskRule);
router.delete("/fabric-risk-rules/:id", ...asAdmin, AdminPricingController.deleteFabricRiskRule);
router.get("/pricing/effective", ...asHrOrManager, AdminPricingController.getEffectivePrice);
router.get("/pricing/global", ...asHrOrManager, AdminPricingController.getGlobalPricing);
router.put("/pricing/global", ...asAdmin, AdminPricingController.setGlobalPricing);
router.get("/pricing/history", ...asAdmin, AdminPricingController.getPricingHistory);
router.get("/stores/:id/pricing", ...asHrOrManager, AdminPricingController.getStorePricing);
router.put("/stores/:id/pricing", ...asAdmin, AdminPricingController.setStorePricing);
router.delete("/stores/:id/pricing/:overrideId", ...asAdmin, AdminPricingController.removeStorePriceOverride);

export default router;
