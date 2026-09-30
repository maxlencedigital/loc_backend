// @generated-scaffold — contract scaffold from the API catalogue; handlers answer 501 until built.
// Once you implement a handler, delete the first line so regeneration can never overwrite your work.
import express from "express";
import { HrLeaveController } from "../Controllers/HrLeave.Controller.js";
import { requireIdentity, requireRole } from "../Middleware/Identity.js";

const router = express.Router();

const asEmployee = [requireIdentity, requireRole("admin", "hr", "manager", "staff", "driver")];
const asHr = [requireIdentity, requireRole("admin", "hr")];
const asHrOrManager = [requireIdentity, requireRole("admin", "hr", "manager")];

router.get("/hr/holidays", ...asEmployee, HrLeaveController.listHolidays);
router.post("/hr/holidays", ...asHr, HrLeaveController.createHoliday);
router.delete("/hr/holidays/:id", ...asHr, HrLeaveController.deleteHoliday);
router.get("/hr/leave/balances", ...asHr, HrLeaveController.listLeaveBalances);
router.get("/hr/leave/calendar", ...asHrOrManager, HrLeaveController.getLeaveCalendar);
router.get("/hr/leave/policies", ...asHr, HrLeaveController.getLeavePolicies);
router.put("/hr/leave/policies", ...asHr, HrLeaveController.setLeavePolicies);
router.get("/hr/leave/requests", ...asHrOrManager, HrLeaveController.listLeaveRequests);
router.get("/hr/leave/requests/pending-count", ...asHrOrManager, HrLeaveController.countPendingLeaveRequests);
router.get("/hr/leave/requests/:id", ...asHrOrManager, HrLeaveController.getLeaveRequest);
router.post("/hr/leave/requests/:id/approve", ...asHrOrManager, HrLeaveController.approveLeaveRequest);
router.post("/hr/leave/requests/:id/reject", ...asHrOrManager, HrLeaveController.rejectLeaveRequest);

export default router;
