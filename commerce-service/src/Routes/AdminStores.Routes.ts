import express from "express";
import { AdminStoresController } from "../Controllers/AdminStores.Controller.js";
import { requireIdentity, requireRole } from "../Middleware/Identity.js";

const router = express.Router();

const asHrOrManager = [requireIdentity, requireRole("admin", "hr", "manager")];
const asAdmin = [requireIdentity, requireRole("admin")];

router.get("/areas", ...asHrOrManager, AdminStoresController.listAreas);
router.post("/areas", ...asAdmin, AdminStoresController.createArea);
router.get("/areas/:id", ...asHrOrManager, AdminStoresController.getArea);
router.patch("/areas/:id", ...asAdmin, AdminStoresController.updateArea);
router.delete("/areas/:id", ...asAdmin, AdminStoresController.deleteArea);
router.get("/customers/:id/stores", ...asHrOrManager, AdminStoresController.getCustomerStoreActivity);
router.get("/stores/compare", ...asHrOrManager, AdminStoresController.compareStores);
router.get("/stores/:id/overview", ...asHrOrManager, AdminStoresController.getStoreOverview);

export default router;
