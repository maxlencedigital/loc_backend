// @generated-scaffold — contract scaffold from the API catalogue; handlers answer 501 until built.
// Once you implement a handler, delete the first line so regeneration can never overwrite your work.
import express from "express";
import { RiderPickupController } from "../Controllers/RiderPickup.Controller.js";
import { requireIdentity, requireRole } from "../Middleware/Identity.js";

const router = express.Router();

const asRider = [requireIdentity, requireRole("driver")];

router.post("/rider/jobs/:id/handoff", ...asRider, RiderPickupController.handOffToStore);
router.post("/rider/jobs/:id/pickup/confirm", ...asRider, RiderPickupController.confirmPickup);
router.post("/rider/jobs/:id/pickup/inspection", ...asRider, RiderPickupController.recordPickupInspection);
router.post("/rider/jobs/:id/pickup/photos", ...asRider, RiderPickupController.uploadPickupPhotos);
router.post("/rider/jobs/:id/pickup/scan", ...asRider, RiderPickupController.scanPickupItem);

export default router;
