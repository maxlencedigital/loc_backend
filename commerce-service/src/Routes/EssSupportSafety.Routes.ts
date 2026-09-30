// @generated-scaffold — contract scaffold from the API catalogue; handlers answer 501 until built.
// Once you implement a handler, delete the first line so regeneration can never overwrite your work.
import express from "express";
import { EssSupportSafetyController } from "../Controllers/EssSupportSafety.Controller.js";
import { requireIdentity, requireRole } from "../Middleware/Identity.js";

const router = express.Router();

const asEmployee = [requireIdentity, requireRole("admin", "hr", "manager", "staff", "driver")];

router.post("/hr/me/grievances", ...asEmployee, EssSupportSafetyController.raiseMyGrievance);
router.get("/hr/me/grievances", ...asEmployee, EssSupportSafetyController.listMyGrievances);
router.get("/hr/me/grievances/:id", ...asEmployee, EssSupportSafetyController.getMyGrievance);
router.get("/hr/me/incidents", ...asEmployee, EssSupportSafetyController.listMyIncidents);
router.post("/hr/me/requests", ...asEmployee, EssSupportSafetyController.sendMyHrRequest);
router.get("/hr/me/requests", ...asEmployee, EssSupportSafetyController.listMyHrRequests);
router.get("/hr/me/requests/:id", ...asEmployee, EssSupportSafetyController.getMyHrRequest);

export default router;
