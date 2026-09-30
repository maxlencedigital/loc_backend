// @generated-scaffold — contract scaffold from the API catalogue; handlers answer 501 until built.
// Once you implement a handler, delete the first line so regeneration can never overwrite your work.
import express from "express";
import { HrAttendanceController } from "../Controllers/HrAttendance.Controller.js";
import { requireIdentity, requireRole } from "../Middleware/Identity.js";

const router = express.Router();

const asHrOrManager = [requireIdentity, requireRole("admin", "hr", "manager")];
const asHr = [requireIdentity, requireRole("admin", "hr")];

router.get("/hr/attendance", ...asHrOrManager, HrAttendanceController.getAttendanceForDay);
router.post("/hr/attendance/corrections", ...asHr, HrAttendanceController.createAttendanceCorrection);
router.get("/hr/attendance/corrections", ...asHr, HrAttendanceController.listAttendanceCorrections);
router.get("/hr/attendance/employees/:id", ...asHrOrManager, HrAttendanceController.getEmployeeAttendance);
router.get("/hr/attendance/summary", ...asHrOrManager, HrAttendanceController.getAttendanceSummary);
router.post("/hr/rosters", ...asHrOrManager, HrAttendanceController.createRosterEntry);
router.get("/hr/rosters", ...asHrOrManager, HrAttendanceController.listRosterEntries);
router.get("/hr/rosters/coverage", ...asHrOrManager, HrAttendanceController.getRosterCoverage);
router.delete("/hr/rosters/:id", ...asHrOrManager, HrAttendanceController.deleteRosterEntry);

export default router;
