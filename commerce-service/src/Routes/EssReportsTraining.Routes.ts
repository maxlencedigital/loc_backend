// @generated-scaffold — contract scaffold from the API catalogue; handlers answer 501 until built.
// Once you implement a handler, delete the first line so regeneration can never overwrite your work.
import express from "express";
import { EssReportsTrainingController } from "../Controllers/EssReportsTraining.Controller.js";
import { requireIdentity, requireRole } from "../Middleware/Identity.js";

const router = express.Router();

const asEmployee = [requireIdentity, requireRole("admin", "hr", "manager", "staff", "driver")];

router.post("/hr/me/daily-reports", ...asEmployee, EssReportsTrainingController.submitMyDailyReport);
router.get("/hr/me/daily-reports", ...asEmployee, EssReportsTrainingController.listMyDailyReports);
router.get("/hr/me/training", ...asEmployee, EssReportsTrainingController.listMyTraining);
router.post("/hr/me/training/:assignmentId/complete", ...asEmployee, EssReportsTrainingController.completeMyTraining);
router.post("/hr/me/training/:assignmentId/start", ...asEmployee, EssReportsTrainingController.startMyTraining);

export default router;
