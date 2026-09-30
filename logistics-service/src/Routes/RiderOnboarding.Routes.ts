// @generated-scaffold — contract scaffold from the API catalogue; handlers answer 501 until built.
// Once you implement a handler, delete the first line so regeneration can never overwrite your work.
import express from "express";
import { RiderOnboardingController } from "../Controllers/RiderOnboarding.Controller.js";

const router = express.Router();

router.get("/public/rider-application-status", RiderOnboardingController.getRiderApplicationStatus);
router.post("/public/rider-applications", RiderOnboardingController.submitRiderApplication);
router.post("/public/rider-applications/:id/documents", RiderOnboardingController.uploadRiderApplicationDocument);

export default router;
