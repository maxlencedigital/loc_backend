// @generated-scaffold — contract scaffold from the API catalogue; handlers answer 501 until built.
// Once you implement a handler, delete the first line so regeneration can never overwrite your work.
import express from "express";
import { StoreProcessingController } from "../Controllers/StoreProcessing.Controller.js";
import { requireIdentity, requireRole } from "../Middleware/Identity.js";

const router = express.Router();

const asStore = [requireIdentity, requireRole("admin", "manager", "staff")];

router.post("/batches", ...asStore, StoreProcessingController.createBatch);
router.get("/batches", ...asStore, StoreProcessingController.listBatches);
router.get("/batches/suggestions", ...asStore, StoreProcessingController.suggestBatches);
router.get("/batches/:id", ...asStore, StoreProcessingController.getBatch);
router.post("/batches/:id/assign-machine", ...asStore, StoreProcessingController.assignBatchMachine);
router.post("/batches/:id/complete", ...asStore, StoreProcessingController.completeBatch);
router.post("/batches/:id/items", ...asStore, StoreProcessingController.addItemsToBatch);
router.delete("/batches/:id/items/:itemId", ...asStore, StoreProcessingController.removeItemFromBatch);
router.post("/batches/:id/start", ...asStore, StoreProcessingController.startBatch);

export default router;
