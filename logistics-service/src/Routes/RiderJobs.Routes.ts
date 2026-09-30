// @generated-scaffold — contract scaffold from the API catalogue; handlers answer 501 until built.
// Once you implement a handler, delete the first line so regeneration can never overwrite your work.
import express from "express";
import { RiderJobsController } from "../Controllers/RiderJobs.Controller.js";
import { requireIdentity, requireRole } from "../Middleware/Identity.js";

const router = express.Router();

const asRider = [requireIdentity, requireRole("driver")];

router.get("/rider/jobs", ...asRider, RiderJobsController.listRiderJobs);
router.get("/rider/jobs/:id", ...asRider, RiderJobsController.getRiderJob);
router.post("/rider/jobs/:id/arrived", ...asRider, RiderJobsController.markRiderArrived);
router.post("/rider/jobs/:id/issue", ...asRider, RiderJobsController.reportRiderJobIssue);
router.post("/rider/jobs/:id/start", ...asRider, RiderJobsController.startRiderJob);
router.get("/rider/route", ...asRider, RiderJobsController.getRiderRoute);

export default router;
