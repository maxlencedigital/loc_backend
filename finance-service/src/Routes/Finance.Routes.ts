import express from "express";
import { HealthController } from "../Controllers/Health.Controller.js";
import PaymentRoutes from "./Payment.Routes.js";
import generatedRoutes from "./Generated.Routes.js";
import internalRoutes from "./Internal.Routes.js";

const router = express.Router();

router.get("/health", HealthController.check);

router.use(PaymentRoutes);

// Dashboard, payments admin, expenses, GST, cash and analytics routes (generated from the API catalogue).
router.use(internalRoutes);
router.use(generatedRoutes);

export default router;
