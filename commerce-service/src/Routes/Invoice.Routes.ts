import express from "express";
import { InvoiceController } from "../Controllers/Invoice.Controller.js";
import { requireIdentity, requireRole } from "../Middleware/Identity.js";

const router = express.Router();

router.use(requireIdentity, requireRole("admin", "staff"));

router.post("/invoices/batch", InvoiceController.runBatch);
router.get("/invoices/:id/print", InvoiceController.printInvoice);

export default router;
