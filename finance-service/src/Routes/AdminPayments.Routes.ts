// @generated-scaffold — contract scaffold from the API catalogue; handlers answer 501 until built.
// Once you implement a handler, delete the first line so regeneration can never overwrite your work.
import express from "express";
import { AdminPaymentsController } from "../Controllers/AdminPayments.Controller.js";
import { requireIdentity, requireRole } from "../Middleware/Identity.js";

const router = express.Router();

const asAdmin = [requireIdentity, requireRole("admin")];

router.get("/payments", ...asAdmin, AdminPaymentsController.listPayments);
router.post("/payments/mismatches/:id/resolve", ...asAdmin, AdminPaymentsController.resolvePaymentMismatch);
router.get("/payments/:id", ...asAdmin, AdminPaymentsController.getPayment);
router.post("/reconciliation/bank-statements", ...asAdmin, AdminPaymentsController.uploadBankStatement);
router.post("/reconciliation/runs", ...asAdmin, AdminPaymentsController.createReconciliationRun);
router.get("/reconciliation/runs", ...asAdmin, AdminPaymentsController.listReconciliationRuns);
router.get("/reconciliation/runs/:id", ...asAdmin, AdminPaymentsController.getReconciliationRun);
router.get("/reconciliation/runs/:id/exceptions", ...asAdmin, AdminPaymentsController.listReconciliationExceptions);
router.post("/refunds", ...asAdmin, AdminPaymentsController.createRefund);
router.get("/refunds", ...asAdmin, AdminPaymentsController.listRefunds);
router.post("/refunds/:id/approve", ...asAdmin, AdminPaymentsController.approveRefund);

export default router;
