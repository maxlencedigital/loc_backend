// @generated-scaffold — contract scaffold from the API catalogue; handlers answer 501 until built.
// Once you implement a handler, delete the first line so regeneration can never overwrite your work.
import express from "express";
import { HrPayController } from "../Controllers/HrPay.Controller.js";
import { requireIdentity, requireRole } from "../Middleware/Identity.js";

const router = express.Router();

const asHr = [requireIdentity, requireRole("admin", "hr")];

router.get("/hr/employees/:id/compensation", ...asHr, HrPayController.getCompensation);
router.put("/hr/employees/:id/compensation", ...asHr, HrPayController.setCompensation);
router.get("/hr/employees/:id/earnings", ...asHr, HrPayController.getEmployeeEarnings);
router.get("/hr/incentive-earnings", ...asHr, HrPayController.listIncentiveEarnings);
router.post("/hr/incentive-earnings/:id/approve", ...asHr, HrPayController.approveIncentiveEarning);
router.get("/hr/incentive-schemes", ...asHr, HrPayController.listIncentiveSchemes);
router.post("/hr/incentive-schemes", ...asHr, HrPayController.createIncentiveScheme);
router.get("/hr/incentive-schemes/:id", ...asHr, HrPayController.getIncentiveScheme);
router.patch("/hr/incentive-schemes/:id", ...asHr, HrPayController.updateIncentiveScheme);
router.post("/hr/incentive-schemes/:id/assign", ...asHr, HrPayController.assignIncentiveScheme);
router.post("/hr/payouts", ...asHr, HrPayController.recordPayout);
router.get("/hr/payouts", ...asHr, HrPayController.listPayouts);

export default router;
