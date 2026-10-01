import express from "express";
import { SupportInternalController } from "../Controllers/SupportInternal.Controller.js";
import { requireServiceCall } from "../Middleware/Identity.js";

const router = express.Router();

// Payments, support, complaints and feedback
// Service-to-service endpoints only: every path starts with /internal and is answered for
// another service (never a user). The gateway refuses to proxy /internal from outside.
router.use("/internal", requireServiceCall);

router.post("/internal/support-tickets/:id/messages", SupportInternalController.replyToTicket);
router.post("/internal/support-tickets/:id/close", SupportInternalController.closeTicket);
router.post("/internal/complaints/close-resolved", SupportInternalController.closeResolvedComplaints);

export default router;
