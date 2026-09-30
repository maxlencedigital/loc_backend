// @generated-scaffold — contract scaffold from the API catalogue; handlers answer 501 until built.
// Once you implement a handler, delete the first line so regeneration can never overwrite your work.
import express from "express";
import { EssAttendanceLeaveController } from "../Controllers/EssAttendanceLeave.Controller.js";
import { requireIdentity, requireRole } from "../Middleware/Identity.js";

const router = express.Router();

const asEmployee = [requireIdentity, requireRole("admin", "hr", "manager", "staff", "driver")];

router.get("/hr/me/attendance", ...asEmployee, EssAttendanceLeaveController.getMyAttendance);
router.post("/hr/me/attendance/clock-in", ...asEmployee, EssAttendanceLeaveController.clockIn);
router.post("/hr/me/attendance/clock-out", ...asEmployee, EssAttendanceLeaveController.clockOut);
router.get("/hr/me/leave-balance", ...asEmployee, EssAttendanceLeaveController.getMyLeaveBalance);
router.post("/hr/me/leave-requests", ...asEmployee, EssAttendanceLeaveController.requestLeave);
router.get("/hr/me/leave-requests", ...asEmployee, EssAttendanceLeaveController.listMyLeaveRequests);
router.post("/hr/me/leave-requests/:id/withdraw", ...asEmployee, EssAttendanceLeaveController.withdrawMyLeaveRequest);

export default router;
