// @generated-scaffold — contract scaffold from the API catalogue; handlers answer 501 until built.
// Once you implement a handler, delete the first line so regeneration can never overwrite your work.
import express from "express";
import { CustomerSupportController } from "../Controllers/CustomerSupport.Controller.js";
import { requireIdentity, requireRole } from "../Middleware/Identity.js";

const router = express.Router();

const asCustomer = [requireIdentity, requireRole("customer")];

router.post("/me/complaints", ...asCustomer, CustomerSupportController.raiseMyComplaint);
router.get("/me/complaints", ...asCustomer, CustomerSupportController.listMyComplaints);
router.get("/me/complaints/:id", ...asCustomer, CustomerSupportController.getMyComplaint);
router.post("/me/complaints/:id/comments", ...asCustomer, CustomerSupportController.commentOnMyComplaint);
router.post("/me/complaints/:id/photos", ...asCustomer, CustomerSupportController.uploadMyComplaintPhotos);
router.post("/me/orders/:id/feedback", ...asCustomer, CustomerSupportController.submitMyFeedback);
router.get("/me/orders/:id/feedback", ...asCustomer, CustomerSupportController.getMyFeedback);
router.post("/me/support-tickets", ...asCustomer, CustomerSupportController.openSupportTicket);
router.get("/me/support-tickets", ...asCustomer, CustomerSupportController.listMySupportTickets);
router.get("/me/support-tickets/:id", ...asCustomer, CustomerSupportController.getMySupportTicket);
router.post("/me/support-tickets/:id/messages", ...asCustomer, CustomerSupportController.replyToMySupportTicket);

export default router;
