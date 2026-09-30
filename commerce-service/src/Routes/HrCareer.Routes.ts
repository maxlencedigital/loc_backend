// @generated-scaffold — contract scaffold from the API catalogue; handlers answer 501 until built.
// Once you implement a handler, delete the first line so regeneration can never overwrite your work.
import express from "express";
import { HrCareerController } from "../Controllers/HrCareer.Controller.js";
import { requireIdentity, requireRole } from "../Middleware/Identity.js";

const router = express.Router();

const asHr = [requireIdentity, requireRole("admin", "hr")];

router.get("/hr/career-paths", ...asHr, HrCareerController.listCareerPaths);
router.put("/hr/career-paths/:role", ...asHr, HrCareerController.setCareerPath);
router.get("/hr/employees/:id/career-plan", ...asHr, HrCareerController.getCareerPlan);
router.put("/hr/employees/:id/career-plan", ...asHr, HrCareerController.setCareerPlan);
router.post("/hr/employees/:id/career-plan/review", ...asHr, HrCareerController.reviewCareerPlan);

export default router;
