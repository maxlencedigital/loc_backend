// @generated-scaffold — contract scaffold from the API catalogue; handlers answer 501 until built.
// Once you implement a handler, delete the first line so regeneration can never overwrite your work.
import express from "express";
import { EssPayPerformanceController } from "../Controllers/EssPayPerformance.Controller.js";
import { requireIdentity, requireRole } from "../Middleware/Identity.js";

const router = express.Router();

const asEmployee = [requireIdentity, requireRole("admin", "hr", "manager", "staff", "driver")];

router.get("/hr/me/appraisals", ...asEmployee, EssPayPerformanceController.listMyAppraisals);
router.get("/hr/me/career-plan", ...asEmployee, EssPayPerformanceController.getMyCareerPlan);
router.get("/hr/me/compensation", ...asEmployee, EssPayPerformanceController.getMyCompensation);
router.get("/hr/me/earnings", ...asEmployee, EssPayPerformanceController.getMyEarnings);
router.get("/hr/me/payouts", ...asEmployee, EssPayPerformanceController.listMyPayouts);
router.get("/hr/me/performance", ...asEmployee, EssPayPerformanceController.getMyPerformance);
router.get("/hr/me/profile", ...asEmployee, EssPayPerformanceController.getMyEmploymentProfile);
router.patch("/hr/me/profile", ...asEmployee, EssPayPerformanceController.updateMyEmploymentProfile);

export default router;
