// @generated-scaffold — contract scaffold from the API catalogue; handlers answer 501 until built.
// Once you implement a handler, delete the first line so regeneration can never overwrite your work.
import express from "express";
import { CustomerPaymentsController } from "../Controllers/CustomerPayments.Controller.js";
import { requireIdentity, requireRole } from "../Middleware/Identity.js";

const router = express.Router();

const asCustomer = [requireIdentity, requireRole("customer")];

router.post("/me/orders/:id/payment/initiate", ...asCustomer, CustomerPaymentsController.initiateMyPayment);
router.post("/me/orders/:id/payment/verify", ...asCustomer, CustomerPaymentsController.verifyMyPayment);
router.get("/me/payment-methods", ...asCustomer, CustomerPaymentsController.listMyPaymentMethods);
router.post("/me/payment-methods", ...asCustomer, CustomerPaymentsController.addMyPaymentMethod);
router.delete("/me/payment-methods/:id", ...asCustomer, CustomerPaymentsController.removeMyPaymentMethod);
router.get("/me/payments", ...asCustomer, CustomerPaymentsController.listMyPayments);

export default router;
