// @generated-scaffold — contract scaffold from the API catalogue; handlers answer 501 until built.
// Once you implement a handler, delete the first line so regeneration can never overwrite your work.
import express from "express";
import { CustomerGarmentProfilesController } from "../Controllers/CustomerGarmentProfiles.Controller.js";
import { requireIdentity, requireRole } from "../Middleware/Identity.js";

const router = express.Router();

const asCustomer = [requireIdentity, requireRole("customer")];

router.get("/me/garment-profiles", ...asCustomer, CustomerGarmentProfilesController.listGarmentProfiles);
router.post("/me/garment-profiles", ...asCustomer, CustomerGarmentProfilesController.createGarmentProfile);
router.get("/me/garment-profiles/:id", ...asCustomer, CustomerGarmentProfilesController.getGarmentProfile);
router.patch("/me/garment-profiles/:id", ...asCustomer, CustomerGarmentProfilesController.updateGarmentProfile);
router.delete("/me/garment-profiles/:id", ...asCustomer, CustomerGarmentProfilesController.deleteGarmentProfile);
router.get("/me/garment-profiles/:id/history", ...asCustomer, CustomerGarmentProfilesController.getMyGarmentHistory);
router.post("/me/garment-profiles/:id/photo", ...asCustomer, CustomerGarmentProfilesController.uploadMyGarmentPhoto);

export default router;
