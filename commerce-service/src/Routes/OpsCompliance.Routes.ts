// @generated-scaffold — contract scaffold from the API catalogue; handlers answer 501 until built.
// Once you implement a handler, delete the first line so regeneration can never overwrite your work.
import express from "express";
import { OpsComplianceController } from "../Controllers/OpsCompliance.Controller.js";
import { requireIdentity, requireRole } from "../Middleware/Identity.js";

const router = express.Router();

const asHrOrManager = [requireIdentity, requireRole("admin", "hr", "manager")];
const asHr = [requireIdentity, requireRole("admin", "hr")];

router.get("/operations/compliance/expiring", ...asHrOrManager, OpsComplianceController.listExpiringCompliance);
router.get("/operations/compliance/items", ...asHrOrManager, OpsComplianceController.listComplianceItems);
router.post("/operations/compliance/items", ...asHr, OpsComplianceController.createComplianceItem);
router.get("/operations/compliance/items/:id", ...asHrOrManager, OpsComplianceController.getComplianceItem);
router.patch("/operations/compliance/items/:id", ...asHr, OpsComplianceController.updateComplianceItem);
router.get("/operations/compliance/items/:id/checklist", ...asHrOrManager, OpsComplianceController.getComplianceChecklist);
router.put("/operations/compliance/items/:id/checklist", ...asHr, OpsComplianceController.setComplianceChecklist);
router.post("/operations/compliance/items/:id/documents", ...asHr, OpsComplianceController.uploadComplianceDocument);
router.post("/operations/compliance/items/:id/renew", ...asHr, OpsComplianceController.renewComplianceItem);
router.get("/operations/compliance/summary", ...asHrOrManager, OpsComplianceController.getComplianceSummary);

export default router;
