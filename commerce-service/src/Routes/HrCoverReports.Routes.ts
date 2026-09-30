// @generated-scaffold — contract scaffold from the API catalogue; handlers answer 501 until built.
// Once you implement a handler, delete the first line so regeneration can never overwrite your work.
import express from "express";
import { HrCoverReportsController } from "../Controllers/HrCoverReports.Controller.js";
import { requireIdentity, requireRole } from "../Middleware/Identity.js";

const router = express.Router();

const asHrOrManager = [requireIdentity, requireRole("admin", "hr", "manager")];

router.get("/hr/absence-cover", ...asHrOrManager, HrCoverReportsController.getAbsenceCover);
router.post("/hr/absence-cover/reassign", ...asHrOrManager, HrCoverReportsController.reassignAbsentWork);
router.get("/hr/daily-reports", ...asHrOrManager, HrCoverReportsController.listDailyReports);
router.get("/hr/daily-reports/patterns", ...asHrOrManager, HrCoverReportsController.getDailyReportPatterns);
router.get("/hr/daily-reports/:id", ...asHrOrManager, HrCoverReportsController.getDailyReport);

export default router;
