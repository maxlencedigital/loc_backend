// @generated-scaffold — contract scaffold from the API catalogue; handlers answer 501 until built.
// Once you implement a handler, delete the first line so regeneration can never overwrite your work.
import express from "express";
import { AdminFeedbackController } from "../Controllers/AdminFeedback.Controller.js";
import { requireIdentity, requireRole } from "../Middleware/Identity.js";

const router = express.Router();

const asAdmin = [requireIdentity, requireRole("admin")];
const asHrOrManager = [requireIdentity, requireRole("admin", "hr", "manager")];

router.get("/escalations", ...asAdmin, AdminFeedbackController.listEscalations);
router.get("/escalations/:id", ...asAdmin, AdminFeedbackController.getEscalation);
router.post("/escalations/:id/decision", ...asAdmin, AdminFeedbackController.decideEscalation);
router.get("/feedback", ...asHrOrManager, AdminFeedbackController.listFeedback);
router.get("/feedback/summary", ...asHrOrManager, AdminFeedbackController.getFeedbackSummary);

export default router;
