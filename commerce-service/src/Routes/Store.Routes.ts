import express from "express";
import { StoreController } from "../Controllers/Store.Controller.js";
import { requireIdentity, requireRole } from "../Middleware/Identity.js";

const router = express.Router();

router.use(requireIdentity, requireRole("admin", "staff"));

router.post("/stores/:id/stock/reconcile", StoreController.reconcileStock);
router.post("/stores/:id/holidays", StoreController.addHoliday);
router.get("/stores/:id/holidays", StoreController.listHolidays);
router.delete("/stores/:id/holidays/:holidayId", StoreController.removeHoliday);
router.get("/stores/:id/employees/:employeeId/performance", StoreController.employeePerformance);
router.get("/stores/:id/reports/daily", StoreController.dailyReport);

export default router;
