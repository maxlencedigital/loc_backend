import express from "express";
import { StoreStockInternalController } from "../Controllers/StoreStockInternal.Controller.js";
import { requireServiceCall } from "../Middleware/Identity.js";

const router = express.Router();

// Store admin: cash, stock, day ops, stores and pricing
// Service-to-service endpoints only: every path starts with /internal and is answered for
// another service (never a user). The gateway refuses to proxy /internal from outside.
router.use("/internal", requireServiceCall);

router.post("/internal/stores/:storeId/stock/:itemId/movements", StoreStockInternalController.recordMovement);

export default router;
