import express from "express";
import { HealthController } from "../Controllers/Health.Controller.js";

const router = express.Router();

router.get("/health", HealthController.check);

// Entity routes (Accounting and Reporting, Analytics and Dashboard)
// are added once the domain models for this service are designed.

export default router;
