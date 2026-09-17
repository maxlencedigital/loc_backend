import express from "express";
import { HealthController } from "../Controllers/Health.Controller.js";
import PaymentRoutes from "./Payment.Routes.js";

const router = express.Router();

router.get("/health", HealthController.check);

router.use(PaymentRoutes);

// Remaining entity routes (Accounting and Reporting, Analytics and
// Dashboard) are added once the domain models for this service are designed.

export default router;
