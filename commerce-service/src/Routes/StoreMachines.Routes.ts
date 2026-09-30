// @generated-scaffold — contract scaffold from the API catalogue; handlers answer 501 until built.
// Once you implement a handler, delete the first line so regeneration can never overwrite your work.
import express from "express";
import { StoreMachinesController } from "../Controllers/StoreMachines.Controller.js";
import { requireIdentity, requireRole } from "../Middleware/Identity.js";

const router = express.Router();

const asStore = [requireIdentity, requireRole("admin", "manager", "staff")];

router.get("/machines", ...asStore, StoreMachinesController.listMachines);
router.get("/machines/available", ...asStore, StoreMachinesController.listAvailableMachines);
router.get("/machines/:id", ...asStore, StoreMachinesController.getMachine);
router.post("/machines/:id/daily-checks", ...asStore, StoreMachinesController.recordMachineDailyCheck);
router.get("/machines/:id/daily-checks", ...asStore, StoreMachinesController.listMachineDailyChecks);
router.post("/machines/:id/faults", ...asStore, StoreMachinesController.reportMachineFault);
router.post("/machines/:id/release", ...asStore, StoreMachinesController.releaseMachine);
router.post("/machines/:id/reserve", ...asStore, StoreMachinesController.reserveMachine);

export default router;
