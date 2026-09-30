// @generated-scaffold — contract scaffold from the API catalogue; handlers answer 501 until built.
// Once you implement a handler, delete the first line so regeneration can never overwrite your work.
import express from "express";
import { CustomerOrderingController } from "../Controllers/CustomerOrdering.Controller.js";
import { requireIdentity, requireRole } from "../Middleware/Identity.js";

const router = express.Router();

const asCustomer = [requireIdentity, requireRole("customer")];

router.get("/me/care-questions", ...asCustomer, CustomerOrderingController.getCareQuestions);
router.post("/me/care-questions/evaluate", ...asCustomer, CustomerOrderingController.evaluateCareAnswers);
router.get("/me/catalog", ...asCustomer, CustomerOrderingController.getMyCatalog);
router.post("/me/express/availability", ...asCustomer, CustomerOrderingController.checkExpressAvailability);
router.post("/me/orders", ...asCustomer, CustomerOrderingController.placeMyOrder);
router.post("/me/orders/:id/photos", ...asCustomer, CustomerOrderingController.uploadMyOrderPhotos);
router.get("/me/pickup-slots", ...asCustomer, CustomerOrderingController.listPickupSlots);
router.post("/me/price-quote", ...asCustomer, CustomerOrderingController.getPriceQuote);

export default router;
