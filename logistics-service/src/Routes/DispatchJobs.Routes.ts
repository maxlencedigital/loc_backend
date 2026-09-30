// @generated-scaffold — contract scaffold from the API catalogue; handlers answer 501 until built.
// Once you implement a handler, delete the first line so regeneration can never overwrite your work.
import express from "express";
import { DispatchJobsController } from "../Controllers/DispatchJobs.Controller.js";
import { requireIdentity, requireRole } from "../Middleware/Identity.js";

const router = express.Router();

const asStore = [requireIdentity, requireRole("admin", "manager", "staff")];

router.post("/jobs", ...asStore, DispatchJobsController.createJob);
router.get("/jobs", ...asStore, DispatchJobsController.listJobs);
router.post("/jobs/auto-assign", ...asStore, DispatchJobsController.autoAssignJobs);
router.get("/jobs/unassigned", ...asStore, DispatchJobsController.listUnassignedJobs);
router.get("/jobs/:id", ...asStore, DispatchJobsController.getJob);
router.patch("/jobs/:id", ...asStore, DispatchJobsController.updateJob);
router.post("/jobs/:id/assign", ...asStore, DispatchJobsController.assignJob);
router.post("/jobs/:id/cancel", ...asStore, DispatchJobsController.cancelJob);
router.get("/jobs/:id/proof", ...asStore, DispatchJobsController.getJobProof);
router.post("/jobs/:id/reassign", ...asStore, DispatchJobsController.reassignJob);
router.get("/jobs/:id/timeline", ...asStore, DispatchJobsController.getJobTimeline);
router.get("/routes", ...asStore, DispatchJobsController.listRoutes);
router.post("/routes/optimize", ...asStore, DispatchJobsController.optimizeRoute);

export default router;
