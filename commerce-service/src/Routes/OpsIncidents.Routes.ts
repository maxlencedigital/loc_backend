// @generated-scaffold — contract scaffold from the API catalogue; handlers answer 501 until built.
// Once you implement a handler, delete the first line so regeneration can never overwrite your work.
import express from "express";
import { OpsIncidentsController } from "../Controllers/OpsIncidents.Controller.js";
import { requireIdentity, requireRole } from "../Middleware/Identity.js";

const router = express.Router();

const asEmployee = [requireIdentity, requireRole("admin", "hr", "manager", "staff", "driver")];
const asHrOrManager = [requireIdentity, requireRole("admin", "hr", "manager")];
const asHr = [requireIdentity, requireRole("admin", "hr")];

router.post("/operations/incidents", ...asEmployee, OpsIncidentsController.reportIncident);
router.get("/operations/incidents", ...asHrOrManager, OpsIncidentsController.listIncidents);
router.get("/operations/incidents/escalated", ...asHr, OpsIncidentsController.listEscalatedIncidents);
router.get("/operations/incidents/summary", ...asHr, OpsIncidentsController.getIncidentSummary);
router.get("/operations/incidents/:id", ...asHrOrManager, OpsIncidentsController.getIncident);
router.post("/operations/incidents/:id/actions", ...asHrOrManager, OpsIncidentsController.recordIncidentAction);
router.post("/operations/incidents/:id/assign", ...asHr, OpsIncidentsController.assignIncident);
router.post("/operations/incidents/:id/claim", ...asHr, OpsIncidentsController.raiseClaimFromIncident);
router.post("/operations/incidents/:id/close", ...asHr, OpsIncidentsController.closeIncident);
router.post("/operations/incidents/:id/escalate", ...asHr, OpsIncidentsController.escalateIncident);
router.post("/operations/incidents/:id/photos", ...asEmployee, OpsIncidentsController.uploadIncidentPhotos);

export default router;
