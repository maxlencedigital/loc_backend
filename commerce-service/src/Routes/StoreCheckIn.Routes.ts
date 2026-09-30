// @generated-scaffold — contract scaffold from the API catalogue; handlers answer 501 until built.
// Once you implement a handler, delete the first line so regeneration can never overwrite your work.
import express from "express";
import { StoreCheckInController } from "../Controllers/StoreCheckIn.Controller.js";
import { requireIdentity, requireRole } from "../Middleware/Identity.js";

const router = express.Router();

const asStore = [requireIdentity, requireRole("admin", "manager", "staff")];

router.get("/fabric-risk-rules", ...asStore, StoreCheckInController.listFabricRiskRules);
router.get("/orders/:id/care-summary", ...asStore, StoreCheckInController.getCareSummary);
router.post("/orders/:id/check-in", ...asStore, StoreCheckInController.checkInOrder);
router.post("/orders/:id/items", ...asStore, StoreCheckInController.addOrderItem);
router.patch("/orders/:id/items/:itemId", ...asStore, StoreCheckInController.updateOrderItem);
router.delete("/orders/:id/items/:itemId", ...asStore, StoreCheckInController.removeOrderItem);
router.post("/orders/:id/items/:itemId/process", ...asStore, StoreCheckInController.setItemProcess);
router.get("/orders/:id/items/:itemId/process-suggestion", ...asStore, StoreCheckInController.getProcessSuggestion);

export default router;
