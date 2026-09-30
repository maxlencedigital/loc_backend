// @generated-scaffold — contract scaffold from the API catalogue; handlers answer 501 until built.
// Once you implement a handler, delete the first line so regeneration can never overwrite your work.
import express from "express";
import paymentsWebhookRoutes from "./PaymentsWebhook.Routes.js";
import adminDashboardRoutes from "./AdminDashboard.Routes.js";
import adminPaymentsRoutes from "./AdminPayments.Routes.js";
import adminExpensesRoutes from "./AdminExpenses.Routes.js";
import adminGstRoutes from "./AdminGst.Routes.js";
import adminCashRoutes from "./AdminCash.Routes.js";
import adminAnalyticsRoutes from "./AdminAnalytics.Routes.js";

const router = express.Router();

router.use(paymentsWebhookRoutes);
router.use(adminDashboardRoutes);
router.use(adminPaymentsRoutes);
router.use(adminExpensesRoutes);
router.use(adminGstRoutes);
router.use(adminCashRoutes);
router.use(adminAnalyticsRoutes);

export default router;
