// @generated-scaffold — contract scaffold from the API catalogue; handlers answer 501 until built.
// Once you implement a handler, delete the first line so regeneration can never overwrite your work.
import express from "express";
import { RiderDeliveryController } from "../Controllers/RiderDelivery.Controller.js";
import { requireIdentity, requireRole } from "../Middleware/Identity.js";

const router = express.Router();

const asRider = [requireIdentity, requireRole("driver")];

router.post("/rider/jobs/:id/delivery/confirm", ...asRider, RiderDeliveryController.confirmDelivery);
router.post("/rider/jobs/:id/delivery/photos", ...asRider, RiderDeliveryController.uploadDeliveryPhotos);
router.post("/rider/jobs/:id/payment", ...asRider, RiderDeliveryController.collectDoorPayment);

export default router;
