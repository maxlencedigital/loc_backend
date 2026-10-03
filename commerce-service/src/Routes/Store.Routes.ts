import express, { NextFunction, Request, Response } from "express";
import { StoreController } from "../Controllers/Store.Controller.js";
import { requireIdentity, requireRole } from "../Middleware/Identity.js";
import { isUuid } from "../Utils/Uuid.js";

const router = express.Router();

// Guarded per route: a shared router.use(['/stores']) would also block roles (hr) that other
// /stores/* routes admit.
const storeStaff = [requireIdentity, requireRole("admin", "manager", "staff")];
const storeReaders = [requireIdentity, requireRole("admin", "hr", "manager", "staff")];

// A literal such as /stores/compare belongs to another router, so a non-id falls through to it.
const onlyStoreIds = (req: Request, _res: Response, next: NextFunction) =>
  isUuid(req.params.id) ? next() : next("route");

router.get("/stores", ...storeReaders, StoreController.list);
router.post("/stores", ...storeStaff, requireRole("admin"), StoreController.create);
router.get("/stores/:id", ...storeReaders, onlyStoreIds, StoreController.getById);
router.patch("/stores/:id", ...storeStaff, requireRole("admin"), StoreController.update);
router.post("/stores/:id/deactivate", ...storeStaff, requireRole("admin"), StoreController.deactivate);

router.post("/stores/:id/stock/reconcile", ...storeStaff, StoreController.reconcileStock);
router.post("/stores/:id/holidays", ...storeStaff, StoreController.addHoliday);
router.get("/stores/:id/holidays", ...storeStaff, StoreController.listHolidays);
router.delete("/stores/:id/holidays/:holidayId", ...storeStaff, StoreController.removeHoliday);
router.get("/stores/:id/employees/:employeeId/performance", ...storeStaff, StoreController.employeePerformance);
router.get("/stores/:id/reports/daily", ...storeStaff, StoreController.dailyReport);

export default router;
