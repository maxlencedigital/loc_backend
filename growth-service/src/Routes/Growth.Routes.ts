import express from "express";
import { HealthController } from "../Controllers/Health.Controller.js";
import generatedRoutes from "./Generated.Routes.js";
import internalRoutes from "./Internal.Routes.js";

const router = express.Router();

router.get("/health", HealthController.check);

// Contract scaffolds for offers, loyalty, retention and campaigns — every handler answers
// 501 until its service logic and models are built. Generated from the API catalogue.
router.use(internalRoutes);
router.use(generatedRoutes);

export default router;
