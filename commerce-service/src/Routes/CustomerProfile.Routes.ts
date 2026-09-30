// @generated-scaffold — contract scaffold from the API catalogue; handlers answer 501 until built.
// Once you implement a handler, delete the first line so regeneration can never overwrite your work.
import express from "express";
import { CustomerProfileController } from "../Controllers/CustomerProfile.Controller.js";
import { requireIdentity, requireRole } from "../Middleware/Identity.js";

const router = express.Router();

const asCustomer = [requireIdentity, requireRole("customer")];

router.get("/me/addresses", ...asCustomer, CustomerProfileController.listAddresses);
router.post("/me/addresses", ...asCustomer, CustomerProfileController.createAddress);
router.get("/me/addresses/:id", ...asCustomer, CustomerProfileController.getAddress);
router.patch("/me/addresses/:id", ...asCustomer, CustomerProfileController.updateAddress);
router.delete("/me/addresses/:id", ...asCustomer, CustomerProfileController.deleteAddress);
router.get("/me/profile", ...asCustomer, CustomerProfileController.getMyProfile);
router.patch("/me/profile", ...asCustomer, CustomerProfileController.updateMyProfile);

export default router;
