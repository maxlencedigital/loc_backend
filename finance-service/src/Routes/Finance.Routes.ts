import express from "express";
import { HealthController } from "../Controllers/Health.Controller.js";
import PaymentRoutes from "./Payment.Routes.js";
import generatedRoutes from "./Generated.Routes.js";

const router = express.Router();

router.get("/health", HealthController.check);

router.use(PaymentRoutes);

// Contract scaffolds for the dashboard, accounting and analytics — every handler answers
// 501 until its service logic and models are built. Generated from the API catalogue.
router.use(generatedRoutes);

export default router;
