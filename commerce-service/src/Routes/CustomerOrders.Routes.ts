// @generated-scaffold — contract scaffold from the API catalogue; handlers answer 501 until built.
// Once you implement a handler, delete the first line so regeneration can never overwrite your work.
import express from "express";
import { CustomerOrdersController } from "../Controllers/CustomerOrders.Controller.js";
import { requireIdentity, requireRole } from "../Middleware/Identity.js";

const router = express.Router();

const asCustomer = [requireIdentity, requireRole("customer")];

router.get("/me/orders", ...asCustomer, CustomerOrdersController.listMyOrders);
router.get("/me/orders/:id", ...asCustomer, CustomerOrdersController.getMyOrder);
router.post("/me/orders/:id/cancel", ...asCustomer, CustomerOrdersController.cancelMyOrder);
router.get("/me/orders/:id/invoice", ...asCustomer, CustomerOrdersController.getMyOrderInvoice);
router.post("/me/orders/:id/reorder", ...asCustomer, CustomerOrdersController.reorderMyOrder);
router.post("/me/orders/:id/reschedule", ...asCustomer, CustomerOrdersController.rescheduleMyPickup);
router.get("/me/orders/:id/tracking", ...asCustomer, CustomerOrdersController.trackMyOrder);

export default router;
