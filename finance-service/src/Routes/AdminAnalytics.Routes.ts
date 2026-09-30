// @generated-scaffold — contract scaffold from the API catalogue; handlers answer 501 until built.
// Once you implement a handler, delete the first line so regeneration can never overwrite your work.
import express from "express";
import { AdminAnalyticsController } from "../Controllers/AdminAnalytics.Controller.js";
import { requireIdentity, requireRole } from "../Middleware/Identity.js";

const router = express.Router();

const asAdmin = [requireIdentity, requireRole("admin")];

router.get("/analytics/order-cost", ...asAdmin, AdminAnalyticsController.getOrderCost);
router.get("/analytics/resource-usage", ...asAdmin, AdminAnalyticsController.getResourceUsage);
router.get("/analytics/store-economics", ...asAdmin, AdminAnalyticsController.getStoreEconomics);

export default router;
