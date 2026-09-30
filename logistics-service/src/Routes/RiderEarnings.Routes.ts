// @generated-scaffold — contract scaffold from the API catalogue; handlers answer 501 until built.
// Once you implement a handler, delete the first line so regeneration can never overwrite your work.
import express from "express";
import { RiderEarningsController } from "../Controllers/RiderEarnings.Controller.js";
import { requireIdentity, requireRole } from "../Middleware/Identity.js";

const router = express.Router();

const asRider = [requireIdentity, requireRole("driver")];

router.get("/rider/cash-balance", ...asRider, RiderEarningsController.getRiderCashBalance);
router.get("/rider/earnings", ...asRider, RiderEarningsController.getRiderEarnings);
router.get("/rider/ratings", ...asRider, RiderEarningsController.getRiderRatings);

export default router;
