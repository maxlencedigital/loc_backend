// @generated-scaffold — contract scaffold from the API catalogue; handlers answer 501 until built.
// Once you implement a handler, delete the first line so regeneration can never overwrite your work.
import express from "express";
import { HrGrievancesController } from "../Controllers/HrGrievances.Controller.js";
import { requireIdentity, requireRole } from "../Middleware/Identity.js";

const router = express.Router();

const asHr = [requireIdentity, requireRole("admin", "hr")];

router.get("/hr/grievances", ...asHr, HrGrievancesController.listGrievances);
router.get("/hr/grievances/:id", ...asHr, HrGrievancesController.getGrievance);
router.post("/hr/grievances/:id/assign", ...asHr, HrGrievancesController.assignGrievance);
router.post("/hr/grievances/:id/close", ...asHr, HrGrievancesController.closeGrievance);
router.post("/hr/grievances/:id/comments", ...asHr, HrGrievancesController.commentOnGrievance);
router.post("/hr/grievances/:id/escalate", ...asHr, HrGrievancesController.escalateGrievance);
router.get("/hr/requests", ...asHr, HrGrievancesController.listHrRequests);
router.get("/hr/requests/:id", ...asHr, HrGrievancesController.getHrRequest);
router.post("/hr/requests/:id/close", ...asHr, HrGrievancesController.closeHrRequest);
router.post("/hr/requests/:id/respond", ...asHr, HrGrievancesController.respondToHrRequest);

export default router;
