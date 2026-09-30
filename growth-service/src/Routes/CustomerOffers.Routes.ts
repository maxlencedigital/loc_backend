// @generated-scaffold — contract scaffold from the API catalogue; handlers answer 501 until built.
// Once you implement a handler, delete the first line so regeneration can never overwrite your work.
import express from "express";
import { CustomerOffersController } from "../Controllers/CustomerOffers.Controller.js";
import { requireIdentity, requireRole } from "../Middleware/Identity.js";

const router = express.Router();

const asCustomer = [requireIdentity, requireRole("customer")];

router.get("/me/coupons", ...asCustomer, CustomerOffersController.listMyCoupons);
router.post("/me/coupons/validate", ...asCustomer, CustomerOffersController.validateMyCoupon);
router.get("/me/loyalty", ...asCustomer, CustomerOffersController.getMyLoyalty);
router.post("/me/loyalty/redeem", ...asCustomer, CustomerOffersController.redeemMyPoints);
router.get("/me/loyalty/transactions", ...asCustomer, CustomerOffersController.listMyLoyaltyTransactions);
router.get("/me/packages/available", ...asCustomer, CustomerOffersController.listAvailablePackages);
router.get("/me/packages/owned", ...asCustomer, CustomerOffersController.listMyPackages);
router.post("/me/packages/:packageId/purchase", ...asCustomer, CustomerOffersController.purchaseMyPackage);

export default router;
