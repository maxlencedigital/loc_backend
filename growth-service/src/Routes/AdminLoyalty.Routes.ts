// @generated-scaffold — contract scaffold from the API catalogue; handlers answer 501 until built.
// Once you implement a handler, delete the first line so regeneration can never overwrite your work.
import express from "express";
import { AdminLoyaltyController } from "../Controllers/AdminLoyalty.Controller.js";
import { requireIdentity, requireRole } from "../Middleware/Identity.js";

const router = express.Router();

const asAdmin = [requireIdentity, requireRole("admin")];

router.get("/loyalty/accounts/:customerId", ...asAdmin, AdminLoyaltyController.getLoyaltyAccount);
router.post("/loyalty/accounts/:customerId/adjustments", ...asAdmin, AdminLoyaltyController.adjustLoyaltyPoints);
router.get("/loyalty/program", ...asAdmin, AdminLoyaltyController.getLoyaltyProgram);
router.put("/loyalty/program", ...asAdmin, AdminLoyaltyController.setLoyaltyProgram);
router.get("/loyalty/transactions", ...asAdmin, AdminLoyaltyController.listLoyaltyTransactions);
router.get("/retention/at-risk", ...asAdmin, AdminLoyaltyController.listAtRiskCustomers);
router.get("/retention/customers/:customerId", ...asAdmin, AdminLoyaltyController.getCustomerRetention);
router.post("/retention/customers/:customerId/win-back", ...asAdmin, AdminLoyaltyController.sendWinBack);
router.get("/retention/summary", ...asAdmin, AdminLoyaltyController.getRetentionSummary);

export default router;
