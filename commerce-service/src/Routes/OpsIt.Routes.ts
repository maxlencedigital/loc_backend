// @generated-scaffold — contract scaffold from the API catalogue; handlers answer 501 until built.
// Once you implement a handler, delete the first line so regeneration can never overwrite your work.
import express from "express";
import { OpsItController } from "../Controllers/OpsIt.Controller.js";
import { requireIdentity, requireRole } from "../Middleware/Identity.js";

const router = express.Router();

const asHr = [requireIdentity, requireRole("admin", "hr")];
const asEmployee = [requireIdentity, requireRole("admin", "hr", "manager", "staff", "driver")];

router.get("/operations/it/devices", ...asHr, OpsItController.listDevices);
router.post("/operations/it/devices", ...asHr, OpsItController.createDevice);
router.get("/operations/it/devices/:id", ...asHr, OpsItController.getDevice);
router.patch("/operations/it/devices/:id", ...asHr, OpsItController.updateDevice);
router.post("/operations/it/devices/:id/assign", ...asHr, OpsItController.assignDevice);
router.post("/operations/it/devices/:id/repairs", ...asHr, OpsItController.createDeviceRepair);
router.get("/operations/it/devices/:id/repairs", ...asHr, OpsItController.listDeviceRepairs);
router.post("/operations/it/devices/:id/return", ...asHr, OpsItController.returnDevice);
router.get("/operations/it/licences", ...asHr, OpsItController.listSoftwareLicences);
router.post("/operations/it/licences", ...asHr, OpsItController.createSoftwareLicence);
router.get("/operations/it/licences/:id", ...asHr, OpsItController.getSoftwareLicence);
router.patch("/operations/it/licences/:id", ...asHr, OpsItController.updateSoftwareLicence);
router.delete("/operations/it/licences/:id", ...asHr, OpsItController.deleteSoftwareLicence);
router.post("/operations/it/licences/:id/assign", ...asHr, OpsItController.assignLicence);
router.post("/operations/it/licences/:id/revoke", ...asHr, OpsItController.revokeLicence);
router.post("/operations/it/requests", ...asEmployee, OpsItController.raiseItRequest);
router.get("/operations/it/requests", ...asEmployee, OpsItController.listItRequests);
router.get("/operations/it/requests/:id", ...asEmployee, OpsItController.getItRequest);
router.patch("/operations/it/requests/:id", ...asHr, OpsItController.updateItRequest);
router.post("/operations/it/requests/:id/close", ...asHr, OpsItController.closeItRequest);
router.post("/operations/it/requests/:id/comments", ...asEmployee, OpsItController.commentOnItRequest);

export default router;
