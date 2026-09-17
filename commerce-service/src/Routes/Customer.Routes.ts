import express from "express";
import { CustomerController } from "../Controllers/Customer.Controller.js";
import { requireIdentity, requireRole } from "../Middleware/Identity.js";

const router = express.Router();

router.post("/customers", requireIdentity, requireRole("admin", "staff"), CustomerController.create);
router.get("/customers", requireIdentity, requireRole("admin", "staff"), CustomerController.list);
router.get("/customers/:id", requireIdentity, requireRole("admin", "staff"), CustomerController.getById);
router.patch("/customers/:id", requireIdentity, requireRole("admin", "staff"), CustomerController.update);

router.get(
  "/customers/:id/preferences",
  requireIdentity,
  requireRole("admin", "staff", "customer"),
  CustomerController.getPreferences
);
router.patch(
  "/customers/:id/preferences",
  requireIdentity,
  requireRole("admin", "staff", "customer"),
  CustomerController.updatePreferences
);

export default router;
