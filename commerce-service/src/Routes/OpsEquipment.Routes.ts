// @generated-scaffold — contract scaffold from the API catalogue; handlers answer 501 until built.
// Once you implement a handler, delete the first line so regeneration can never overwrite your work.
import express from "express";
import { OpsEquipmentController } from "../Controllers/OpsEquipment.Controller.js";
import { requireIdentity, requireRole } from "../Middleware/Identity.js";

const router = express.Router();

const asHrOrManager = [requireIdentity, requireRole("admin", "hr", "manager")];
const asHr = [requireIdentity, requireRole("admin", "hr")];

router.get("/operations/equipment", ...asHrOrManager, OpsEquipmentController.listEquipment);
router.post("/operations/equipment", ...asHr, OpsEquipmentController.createEquipmentItem);
router.get("/operations/equipment/replacement-review", ...asHr, OpsEquipmentController.getReplacementReview);
router.get("/operations/equipment/summary", ...asHrOrManager, OpsEquipmentController.getEquipmentSummary);
router.get("/operations/equipment/:id", ...asHrOrManager, OpsEquipmentController.getEquipmentItem);
router.patch("/operations/equipment/:id", ...asHr, OpsEquipmentController.updateEquipmentItem);
router.get("/operations/equipment/:id/downtime", ...asHrOrManager, OpsEquipmentController.getEquipmentDowntime);
router.post("/operations/equipment/:id/inspections", ...asHrOrManager, OpsEquipmentController.recordEquipmentInspection);
router.get("/operations/equipment/:id/inspections", ...asHrOrManager, OpsEquipmentController.listEquipmentInspections);
router.get("/operations/equipment/:id/maintenance-schedule", ...asHrOrManager, OpsEquipmentController.getMaintenanceSchedule);
router.put("/operations/equipment/:id/maintenance-schedule", ...asHr, OpsEquipmentController.setMaintenanceSchedule);
router.post("/operations/equipment/:id/repairs", ...asHrOrManager, OpsEquipmentController.createEquipmentRepair);
router.get("/operations/equipment/:id/repairs", ...asHrOrManager, OpsEquipmentController.listEquipmentRepairs);
router.patch("/operations/equipment/:id/repairs/:repairId", ...asHrOrManager, OpsEquipmentController.updateEquipmentRepair);
router.post("/operations/equipment/:id/retire", ...asHr, OpsEquipmentController.retireEquipment);
router.get("/operations/maintenance/due", ...asHrOrManager, OpsEquipmentController.listMaintenanceDue);
router.get("/operations/maintenance/overdue", ...asHrOrManager, OpsEquipmentController.listMaintenanceOverdue);
router.post("/operations/maintenance/tasks/:taskId/complete", ...asHrOrManager, OpsEquipmentController.completeMaintenanceTask);

export default router;
