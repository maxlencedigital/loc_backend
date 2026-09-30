// @generated-scaffold — contract scaffold from the API catalogue; handlers answer 501 until built.
// Once you implement a handler, delete the first line so regeneration can never overwrite your work.
import express from "express";
import { AdminDashboardController } from "../Controllers/AdminDashboard.Controller.js";
import { requireIdentity, requireRole } from "../Middleware/Identity.js";

const router = express.Router();

const asAdmin = [requireIdentity, requireRole("admin")];

router.get("/dashboard/orders", ...asAdmin, AdminDashboardController.getDashboardOrders);
router.get("/dashboard/overview", ...asAdmin, AdminDashboardController.getDashboardOverview);
router.get("/dashboard/people", ...asAdmin, AdminDashboardController.getDashboardPeople);
router.get("/dashboard/revenue", ...asAdmin, AdminDashboardController.getDashboardRevenue);
router.get("/dashboard/risks", ...asAdmin, AdminDashboardController.getDashboardRisks);
router.get("/dashboard/satisfaction", ...asAdmin, AdminDashboardController.getDashboardSatisfaction);
router.get("/dashboard/stores", ...asAdmin, AdminDashboardController.getDashboardStores);

export default router;
