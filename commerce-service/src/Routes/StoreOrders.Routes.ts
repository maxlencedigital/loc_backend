import express from "express";
import { StoreOrdersController } from "../Controllers/StoreOrders.Controller.js";
import { requireIdentity, requireRole } from "../Middleware/Identity.js";

const router = express.Router();

const asStore = [requireIdentity, requireRole("admin", "manager", "staff")];
const asManager = [requireIdentity, requireRole("admin", "manager")];

router.post("/orders/:id/notes", ...asStore, StoreOrdersController.addOrderNote);
router.post("/orders/:id/route-to-store", ...asManager, StoreOrdersController.routeOrderToStore);
router.get("/orders/:id/timeline", ...asStore, StoreOrdersController.getOrderTimeline);
router.post("/walk-in/orders", ...asStore, StoreOrdersController.createWalkInOrder);

export default router;
