// @generated-scaffold — contract scaffold from the API catalogue; handlers answer 501 until built.
// Once you implement a handler, delete the first line so regeneration can never overwrite your work.
import express from "express";
import { AdminCapacityController } from "../Controllers/AdminCapacity.Controller.js";
import { requireIdentity, requireRole } from "../Middleware/Identity.js";

const router = express.Router();

const asHrOrManager = [requireIdentity, requireRole("admin", "hr", "manager")];

router.get("/operations/capacity/forecast", ...asHrOrManager, AdminCapacityController.getCapacityForecast);
router.get("/operations/capacity/now", ...asHrOrManager, AdminCapacityController.getCapacityNow);
router.get("/operations/express/at-risk", ...asHrOrManager, AdminCapacityController.listExpressAtRisk);

export default router;
