// @generated-scaffold — contract scaffold from the API catalogue; handlers answer 501 until built.
// Once you implement a handler, delete the first line so regeneration can never overwrite your work.
import express from "express";
import { RiderShiftController } from "../Controllers/RiderShift.Controller.js";
import { requireIdentity, requireRole } from "../Middleware/Identity.js";

const router = express.Router();

const asRider = [requireIdentity, requireRole("driver")];

router.put("/rider/availability", ...asRider, RiderShiftController.setRiderAvailability);
router.post("/rider/location", ...asRider, RiderShiftController.postRiderLocation);
router.get("/rider/me", ...asRider, RiderShiftController.getRiderProfile);
router.post("/rider/shift/end", ...asRider, RiderShiftController.endRiderShift);
router.post("/rider/shift/start", ...asRider, RiderShiftController.startRiderShift);
router.get("/rider/shift/summary", ...asRider, RiderShiftController.getRiderShiftSummary);

export default router;
