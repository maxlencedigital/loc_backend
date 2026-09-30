// @generated-scaffold — contract scaffold from the API catalogue; handlers answer 501 until built.
// Once you implement a handler, delete the first line so regeneration can never overwrite your work.
import express from "express";
import { HrRidersController } from "../Controllers/HrRiders.Controller.js";
import { requireIdentity, requireRole } from "../Middleware/Identity.js";

const router = express.Router();

const asHr = [requireIdentity, requireRole("admin", "hr")];
const asAdminHrManagerStaff = [requireIdentity, requireRole("admin", "hr", "manager", "staff")];

router.get("/rider-applications", ...asHr, HrRidersController.listRiderApplications);
router.get("/rider-applications/:id", ...asHr, HrRidersController.getRiderApplication);
router.post("/rider-applications/:id/approve", ...asHr, HrRidersController.approveRiderApplication);
router.post("/rider-applications/:id/reject", ...asHr, HrRidersController.rejectRiderApplication);
router.post("/rider-applications/:id/request-documents", ...asHr, HrRidersController.requestRiderDocuments);
router.post("/rider-applications/:id/verify", ...asHr, HrRidersController.verifyRiderApplication);
router.get("/rider-performance", ...asHr, HrRidersController.listRiderPerformance);
router.get("/riders/:id/eligibility", ...asAdminHrManagerStaff, HrRidersController.getRiderEligibility);
router.get("/riders/:id/performance", ...asHr, HrRidersController.getRiderPerformance);
router.post("/riders/:id/reinstate", ...asHr, HrRidersController.reinstateRider);
router.post("/riders/:id/suspend", ...asHr, HrRidersController.suspendRider);

export default router;
