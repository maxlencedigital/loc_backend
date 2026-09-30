// @generated-scaffold — contract scaffold from the API catalogue; handlers answer 501 until built.
// Once you implement a handler, delete the first line so regeneration can never overwrite your work.
import express from "express";
import { DispatchRidersController } from "../Controllers/DispatchRiders.Controller.js";
import { requireIdentity, requireRole } from "../Middleware/Identity.js";

const router = express.Router();

const asStore = [requireIdentity, requireRole("admin", "manager", "staff")];
const asAdminHrManagerStaff = [requireIdentity, requireRole("admin", "hr", "manager", "staff")];

router.get("/field-payments", ...asStore, DispatchRidersController.listFieldPayments);
router.get("/field-payments/:id", ...asStore, DispatchRidersController.getFieldPayment);
router.post("/field-payments/:id/settle", ...asStore, DispatchRidersController.settleFieldPayment);
router.get("/riders", ...asAdminHrManagerStaff, DispatchRidersController.listRiders);
router.get("/riders/available", ...asStore, DispatchRidersController.listAvailableRiders);
router.get("/riders/:id", ...asAdminHrManagerStaff, DispatchRidersController.getRider);
router.get("/riders/:id/cash-balance", ...asStore, DispatchRidersController.getRiderCashBalanceForDispatch);
router.get("/riders/:id/location", ...asStore, DispatchRidersController.getRiderLocation);

export default router;
