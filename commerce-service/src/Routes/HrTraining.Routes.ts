// @generated-scaffold — contract scaffold from the API catalogue; handlers answer 501 until built.
// Once you implement a handler, delete the first line so regeneration can never overwrite your work.
import express from "express";
import { HrTrainingController } from "../Controllers/HrTraining.Controller.js";
import { requireIdentity, requireRole } from "../Middleware/Identity.js";

const router = express.Router();

const asHr = [requireIdentity, requireRole("admin", "hr")];
const asEmployee = [requireIdentity, requireRole("admin", "hr", "manager", "staff", "driver")];
const asHrOrManager = [requireIdentity, requireRole("admin", "hr", "manager")];

router.post("/hr/training/assignments", ...asHr, HrTrainingController.assignTraining);
router.get("/hr/training/assignments", ...asHr, HrTrainingController.listTrainingAssignments);
router.patch("/hr/training/assignments/:id", ...asHr, HrTrainingController.updateTrainingAssignment);
router.get("/hr/training/courses", ...asEmployee, HrTrainingController.listTrainingCourses);
router.post("/hr/training/courses", ...asHr, HrTrainingController.createTrainingCourse);
router.get("/hr/training/courses/:id", ...asEmployee, HrTrainingController.getTrainingCourse);
router.patch("/hr/training/courses/:id", ...asHr, HrTrainingController.updateTrainingCourse);
router.delete("/hr/training/courses/:id", ...asHr, HrTrainingController.deleteTrainingCourse);
router.get("/hr/training/overdue", ...asHrOrManager, HrTrainingController.listOverdueTraining);
router.get("/hr/training/refreshers-due", ...asHrOrManager, HrTrainingController.listRefreshersDue);
router.get("/hr/training/requirements", ...asHr, HrTrainingController.listTrainingRequirements);
router.put("/hr/training/requirements/:role", ...asHr, HrTrainingController.setTrainingRequirements);

export default router;
