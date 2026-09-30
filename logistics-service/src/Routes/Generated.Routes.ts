// @generated-scaffold — contract scaffold from the API catalogue; handlers answer 501 until built.
// Once you implement a handler, delete the first line so regeneration can never overwrite your work.
import express from "express";
import riderOnboardingRoutes from "./RiderOnboarding.Routes.js";
import riderShiftRoutes from "./RiderShift.Routes.js";
import riderJobsRoutes from "./RiderJobs.Routes.js";
import riderPickupRoutes from "./RiderPickup.Routes.js";
import riderDeliveryRoutes from "./RiderDelivery.Routes.js";
import riderEarningsRoutes from "./RiderEarnings.Routes.js";
import dispatchJobsRoutes from "./DispatchJobs.Routes.js";
import dispatchRidersRoutes from "./DispatchRiders.Routes.js";
import hrRidersRoutes from "./HrRiders.Routes.js";

const router = express.Router();

router.use(riderOnboardingRoutes);
router.use(riderShiftRoutes);
router.use(riderJobsRoutes);
router.use(riderPickupRoutes);
router.use(riderDeliveryRoutes);
router.use(riderEarningsRoutes);
router.use(dispatchJobsRoutes);
router.use(dispatchRidersRoutes);
router.use(hrRidersRoutes);

export default router;
