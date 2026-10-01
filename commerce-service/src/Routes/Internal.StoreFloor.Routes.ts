import express from "express";
import { StoreFloorInternalController } from "../Controllers/StoreFloorInternal.Controller.js";
import { requireServiceCall } from "../Middleware/Identity.js";

const router = express.Router();

// Store floor: check-in, processing, machines, quality
// Service-to-service endpoints only: every path starts with /internal and is answered for
// another service (never a user). The gateway refuses to proxy /internal from outside.
router.use("/internal", requireServiceCall);

// "faults" and "state" are fixed words, not machine ids: the register addresses a machine in the body.
router.post("/internal/machines", StoreFloorInternalController.registerMachine);
router.post("/internal/machines/state", StoreFloorInternalController.setMachineState);
router.get("/internal/machines/faults", StoreFloorInternalController.listOpenFaults);

export default router;
