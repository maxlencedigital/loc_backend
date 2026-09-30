// @generated-scaffold — contract scaffold from the API catalogue; handlers answer 501 until built.
// Once you implement a handler, delete the first line so regeneration can never overwrite your work.
import express from "express";
import { StoreDayOpsController } from "../Controllers/StoreDayOps.Controller.js";
import { requireIdentity, requireRole } from "../Middleware/Identity.js";

const router = express.Router();

const asManager = [requireIdentity, requireRole("admin", "manager")];
const asStore = [requireIdentity, requireRole("admin", "manager", "staff")];

router.get("/stores/:id/performance", ...asManager, StoreDayOpsController.getStorePerformance);
router.post("/stores/:id/resource-readings", ...asStore, StoreDayOpsController.recordResourceReading);
router.get("/stores/:id/resource-readings", ...asStore, StoreDayOpsController.listResourceReadings);
router.get("/stores/:id/staff", ...asManager, StoreDayOpsController.listStoreStaff);
router.get("/stores/:id/tasks/today", ...asStore, StoreDayOpsController.getStoreTasksToday);

export default router;
