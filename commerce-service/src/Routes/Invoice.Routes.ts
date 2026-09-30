import express from "express";
import { InvoiceController } from "../Controllers/Invoice.Controller.js";
import { requireIdentity, requireRole } from "../Middleware/Identity.js";

const router = express.Router();

// Scoped to this router's own paths. An unscoped router.use() runs for EVERY request
// that reaches the commerce router, so it would block other roles' routes mounted later.
router.use(["/invoices"], requireIdentity, requireRole("admin", "manager", "staff"));

router.post("/invoices/batch", InvoiceController.runBatch);
router.get("/invoices/:id/print", InvoiceController.printInvoice);

export default router;
