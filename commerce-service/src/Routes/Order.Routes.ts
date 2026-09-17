import express from "express";
import { OrderController } from "../Controllers/Order.Controller.js";
import { requireIdentity, requireRole } from "../Middleware/Identity.js";

const router = express.Router();

router.use(requireIdentity, requireRole("admin", "staff"));

router.post("/orders", OrderController.create);
router.get("/orders", OrderController.list);
router.get("/orders/:id", OrderController.getById);
router.patch("/orders/:id", OrderController.update);
router.post("/orders/:id/tags", OrderController.generateTags);
router.post("/orders/:id/discount", OrderController.applyDiscount);
router.post("/orders/:id/payment", OrderController.initiatePayment);
router.post("/orders/:id/return", OrderController.returnItems);
router.post("/orders/:id/finish", OrderController.finish);
router.get("/orders/:id/packing-sticker", OrderController.packingSticker);

export default router;
