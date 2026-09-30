// @generated-scaffold — contract scaffold from the API catalogue; handlers answer 501 until built.
// Once you implement a handler, delete the first line so regeneration can never overwrite your work.
import express from "express";
import customerOffersRoutes from "./CustomerOffers.Routes.js";
import customerNotificationsRoutes from "./CustomerNotifications.Routes.js";
import adminCouponsRoutes from "./AdminCoupons.Routes.js";
import adminLoyaltyRoutes from "./AdminLoyalty.Routes.js";
import adminCampaignsRoutes from "./AdminCampaigns.Routes.js";

const router = express.Router();

router.use(customerOffersRoutes);
router.use(customerNotificationsRoutes);
router.use(adminCouponsRoutes);
router.use(adminLoyaltyRoutes);
router.use(adminCampaignsRoutes);

export default router;
