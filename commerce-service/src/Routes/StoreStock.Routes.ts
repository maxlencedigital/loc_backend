// @generated-scaffold — contract scaffold from the API catalogue; handlers answer 501 until built.
// Once you implement a handler, delete the first line so regeneration can never overwrite your work.
import express from "express";
import { StoreStockController } from "../Controllers/StoreStock.Controller.js";
import { requireIdentity, requireRole } from "../Middleware/Identity.js";

const router = express.Router();

const asStore = [requireIdentity, requireRole("admin", "manager", "staff")];
const asAdminHrManagerStaff = [requireIdentity, requireRole("admin", "hr", "manager", "staff")];

router.get("/stores/:id/stock", ...asStore, StoreStockController.listStoreStock);
router.get("/stores/:id/stock/alerts", ...asAdminHrManagerStaff, StoreStockController.listStockAlerts);
router.get("/stores/:id/stock/:itemId", ...asStore, StoreStockController.getStoreStockItem);
router.post("/stores/:id/stock/:itemId/low-alert", ...asStore, StoreStockController.flagLowStock);

export default router;
