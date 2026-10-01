import express from "express";
import { HrPeopleInternalController } from "../Controllers/HrPeopleInternal.Controller.js";
import { requireServiceCall } from "../Middleware/Identity.js";

const router = express.Router();

// HR people: training, performance, pay, grievances
// Service-to-service endpoints only: every path starts with /internal and is answered for
// another service (never a user). The gateway refuses to proxy /internal from outside.
router.use("/internal", requireServiceCall);

router.post("/internal/hr/incentive-metrics", HrPeopleInternalController.reportIncentiveMetrics);

export default router;
