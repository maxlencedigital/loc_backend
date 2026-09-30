import express from "express";
import { OrderController } from "../Controllers/Order.Controller.js";
import { requireIdentity, requireRole } from "../Middleware/Identity.js";

const router = express.Router();

// Scoped to this router's own paths. An unscoped router.use() runs for EVERY request
// that reaches the commerce router, so it would block other roles' routes mounted later.
router.use(["/orders"], requireIdentity, requireRole("admin", "manager", "staff"));

router.post("/orders", OrderController.create);
router.get("/orders", OrderController.list);
// Registered before /orders/:id, which would otherwise read "pipeline" as an id.
router.get("/orders/pipeline", OrderController.pipeline);
router.get("/orders/:id", OrderController.getById);
router.post("/orders/:id/status", OrderController.changeStatus);
router.post("/orders/:id/cancel", requireRole("admin", "manager"), OrderController.cancel);
router.patch("/orders/:id", OrderController.update);
router.post("/orders/:id/tags", OrderController.generateTags);
router.post("/orders/:id/discount", OrderController.applyDiscount);
router.post("/orders/:id/payment", OrderController.initiatePayment);
router.post("/orders/:id/return", OrderController.returnItems);
router.post("/orders/:id/finish", OrderController.finish);
router.get("/orders/:id/packing-sticker", OrderController.packingSticker);

export default router;
