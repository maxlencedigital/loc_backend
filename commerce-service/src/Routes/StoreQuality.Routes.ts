// @generated-scaffold — contract scaffold from the API catalogue; handlers answer 501 until built.
// Once you implement a handler, delete the first line so regeneration can never overwrite your work.
import express from "express";
import { StoreQualityController } from "../Controllers/StoreQuality.Controller.js";
import { requireIdentity, requireRole } from "../Middleware/Identity.js";

const router = express.Router();

const asStore = [requireIdentity, requireRole("admin", "manager", "staff")];

router.post("/orders/:id/collect", ...asStore, StoreQualityController.markCollectedAtCounter);
router.post("/orders/:id/quality-check", ...asStore, StoreQualityController.recordQualityCheck);
router.get("/orders/:id/quality-check", ...asStore, StoreQualityController.getQualityCheck);
router.post("/orders/:id/ready", ...asStore, StoreQualityController.markOrderReady);

export default router;
