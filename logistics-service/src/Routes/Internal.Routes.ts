import express from "express";
import { requireServiceCall } from "../Middleware/Identity.js";
import { InternalController } from "../Controllers/Internal.Controller.js";

const router = express.Router();

// Logistics service internal API.
// Service-to-service endpoints only: every path starts with /internal and is answered for
// another service (never a user). The gateway refuses to proxy /internal from outside.
router.use("/internal", requireServiceCall);

// Commerce asks for a pickup or delivery job for an order (idempotent on orderId + type) and looks jobs up.
router.post("/internal/jobs", InternalController.createJob);
router.get("/internal/jobs", InternalController.jobsForOrder);
// Re-sends the order updates that could not reach commerce; run from a scheduler or by hand.
router.post("/internal/jobs/retry-sync", InternalController.retrySync);
// A customer's rating of a finished job, from whichever service collects it.
router.post("/internal/ratings", InternalController.recordRating);

export default router;
