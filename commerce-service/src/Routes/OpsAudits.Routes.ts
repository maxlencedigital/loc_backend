// @generated-scaffold — contract scaffold from the API catalogue; handlers answer 501 until built.
// Once you implement a handler, delete the first line so regeneration can never overwrite your work.
import express from "express";
import { OpsAuditsController } from "../Controllers/OpsAudits.Controller.js";
import { requireIdentity, requireRole } from "../Middleware/Identity.js";

const router = express.Router();

const asHr = [requireIdentity, requireRole("admin", "hr")];
const asHrOrManager = [requireIdentity, requireRole("admin", "hr", "manager")];

router.post("/operations/audits", ...asHr, OpsAuditsController.createAudit);
router.get("/operations/audits", ...asHrOrManager, OpsAuditsController.listAudits);
router.get("/operations/audits/evidence", ...asHr, OpsAuditsController.getAuditEvidence);
router.get("/operations/audits/findings/open", ...asHrOrManager, OpsAuditsController.listOpenAuditFindings);
router.patch("/operations/audits/findings/:findingId", ...asHr, OpsAuditsController.updateAuditFinding);
router.post("/operations/audits/findings/:findingId/close", ...asHr, OpsAuditsController.closeAuditFinding);
router.get("/operations/audits/:id", ...asHrOrManager, OpsAuditsController.getAudit);
router.patch("/operations/audits/:id", ...asHr, OpsAuditsController.updateAudit);
router.post("/operations/audits/:id/complete", ...asHr, OpsAuditsController.completeAudit);
router.post("/operations/audits/:id/findings", ...asHr, OpsAuditsController.createAuditFinding);
router.get("/operations/audits/:id/findings", ...asHrOrManager, OpsAuditsController.listAuditFindings);
router.post("/operations/audits/:id/start", ...asHr, OpsAuditsController.startAudit);

export default router;
