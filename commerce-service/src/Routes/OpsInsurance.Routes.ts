// @generated-scaffold — contract scaffold from the API catalogue; handlers answer 501 until built.
// Once you implement a handler, delete the first line so regeneration can never overwrite your work.
import express from "express";
import { OpsInsuranceController } from "../Controllers/OpsInsurance.Controller.js";
import { requireIdentity, requireRole } from "../Middleware/Identity.js";

const router = express.Router();

const asHr = [requireIdentity, requireRole("admin", "hr")];
const asHrOrManager = [requireIdentity, requireRole("admin", "hr", "manager")];

router.post("/operations/insurance/claims", ...asHr, OpsInsuranceController.createInsuranceClaim);
router.get("/operations/insurance/claims", ...asHr, OpsInsuranceController.listInsuranceClaims);
router.get("/operations/insurance/claims/history", ...asHr, OpsInsuranceController.getClaimsHistory);
router.get("/operations/insurance/claims/:id", ...asHr, OpsInsuranceController.getInsuranceClaim);
router.patch("/operations/insurance/claims/:id", ...asHr, OpsInsuranceController.updateInsuranceClaim);
router.post("/operations/insurance/claims/:id/documents", ...asHr, OpsInsuranceController.uploadInsuranceClaimDocument);
router.post("/operations/insurance/claims/:id/settle", ...asHr, OpsInsuranceController.settleInsuranceClaim);
router.get("/operations/insurance/policies", ...asHrOrManager, OpsInsuranceController.listInsurancePolicies);
router.post("/operations/insurance/policies", ...asHr, OpsInsuranceController.createInsurancePolicy);
router.get("/operations/insurance/policies/:id", ...asHrOrManager, OpsInsuranceController.getInsurancePolicy);
router.patch("/operations/insurance/policies/:id", ...asHr, OpsInsuranceController.updateInsurancePolicy);
router.post("/operations/insurance/policies/:id/documents", ...asHr, OpsInsuranceController.uploadInsurancePolicyDocument);
router.post("/operations/insurance/policies/:id/renew", ...asHr, OpsInsuranceController.renewInsurancePolicy);
router.get("/operations/insurance/renewals", ...asHrOrManager, OpsInsuranceController.listInsuranceRenewals);
router.get("/operations/insurance/riders/:riderId/cover-status", ...asHrOrManager, OpsInsuranceController.getRiderCoverStatus);

export default router;
