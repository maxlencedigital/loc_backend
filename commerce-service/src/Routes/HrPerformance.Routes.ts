// @generated-scaffold — contract scaffold from the API catalogue; handlers answer 501 until built.
// Once you implement a handler, delete the first line so regeneration can never overwrite your work.
import express from "express";
import { HrPerformanceController } from "../Controllers/HrPerformance.Controller.js";
import { requireIdentity, requireRole } from "../Middleware/Identity.js";

const router = express.Router();

const asHr = [requireIdentity, requireRole("admin", "hr")];
const asHrOrManager = [requireIdentity, requireRole("admin", "hr", "manager")];

router.get("/hr/appraisals", ...asHr, HrPerformanceController.listAppraisals);
router.post("/hr/appraisals", ...asHr, HrPerformanceController.createAppraisal);
router.post("/hr/appraisals/schedule", ...asHr, HrPerformanceController.scheduleAppraisals);
router.get("/hr/appraisals/:id", ...asHr, HrPerformanceController.getAppraisal);
router.patch("/hr/appraisals/:id", ...asHr, HrPerformanceController.updateAppraisal);
router.post("/hr/appraisals/:id/complete", ...asHr, HrPerformanceController.completeAppraisal);
router.post("/hr/appraisals/:id/conduct", ...asHr, HrPerformanceController.conductAppraisal);
router.get("/hr/performance/employees/:id", ...asHrOrManager, HrPerformanceController.getEmployeePerformance);
router.get("/hr/performance/summary", ...asHrOrManager, HrPerformanceController.getPerformanceSummary);

export default router;
