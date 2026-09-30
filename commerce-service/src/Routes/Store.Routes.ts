import express, { NextFunction, Request, Response } from "express";
import { StoreController } from "../Controllers/Store.Controller.js";
import { requireIdentity, requireRole } from "../Middleware/Identity.js";
import { isUuid } from "../Utils/Uuid.js";

const router = express.Router();

// Scoped to this router's own paths. An unscoped router.use() runs for EVERY request
// that reaches the commerce router, so it would block other roles' routes mounted later.
router.use(["/stores"], requireIdentity, requireRole("admin", "manager", "staff"));

// A literal such as /stores/compare belongs to another router, so a non-id falls through to it.
const onlyStoreIds = (req: Request, _res: Response, next: NextFunction) =>
  isUuid(req.params.id) ? next() : next("route");

router.get("/stores", StoreController.list);
router.post("/stores", requireRole("admin"), StoreController.create);
router.get("/stores/:id", onlyStoreIds, StoreController.getById);
router.patch("/stores/:id", requireRole("admin"), StoreController.update);
router.post("/stores/:id/deactivate", requireRole("admin"), StoreController.deactivate);

router.post("/stores/:id/stock/reconcile", StoreController.reconcileStock);
router.post("/stores/:id/holidays", StoreController.addHoliday);
router.get("/stores/:id/holidays", StoreController.listHolidays);
router.delete("/stores/:id/holidays/:holidayId", StoreController.removeHoliday);
router.get("/stores/:id/employees/:employeeId/performance", StoreController.employeePerformance);
router.get("/stores/:id/reports/daily", StoreController.dailyReport);

export default router;
