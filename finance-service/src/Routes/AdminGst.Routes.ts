// @generated-scaffold — contract scaffold from the API catalogue; handlers answer 501 until built.
// Once you implement a handler, delete the first line so regeneration can never overwrite your work.
import express from "express";
import { AdminGstController } from "../Controllers/AdminGst.Controller.js";
import { requireIdentity, requireRole } from "../Middleware/Identity.js";

const router = express.Router();

const asAdmin = [requireIdentity, requireRole("admin")];

router.get("/gst/reports", ...asAdmin, AdminGstController.listGstReports);
router.post("/gst/reports/generate", ...asAdmin, AdminGstController.generateGstReport);
router.get("/gst/reports/:id", ...asAdmin, AdminGstController.getGstReport);
router.get("/gst/reports/:id/export", ...asAdmin, AdminGstController.exportGstReport);
router.get("/ledger", ...asAdmin, AdminGstController.listLedgerEntries);
router.get("/ledger/summary", ...asAdmin, AdminGstController.getLedgerSummary);
router.get("/receivables", ...asAdmin, AdminGstController.listReceivables);
router.get("/receivables/aging", ...asAdmin, AdminGstController.getReceivablesAging);
router.post("/receivables/reminders/run", ...asAdmin, AdminGstController.runReceivableReminders);
router.get("/receivables/:id", ...asAdmin, AdminGstController.getReceivable);
router.post("/receivables/:id/payments", ...asAdmin, AdminGstController.recordReceivablePayment);
router.post("/receivables/:id/reminder", ...asAdmin, AdminGstController.sendReceivableReminder);

export default router;
