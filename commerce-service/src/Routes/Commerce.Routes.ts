import express from "express";
import { HealthController } from "../Controllers/Health.Controller.js";
import orderRoutes from "./Order.Routes.js";
import customerRoutes from "./Customer.Routes.js";
import catalogRoutes from "./Catalog.Routes.js";
import garmentRoutes from "./Garment.Routes.js";
import storeRoutes from "./Store.Routes.js";
import invoiceRoutes from "./Invoice.Routes.js";

const router = express.Router();

router.get("/health", HealthController.check);

// POS and Store Management routes below are contract-only scaffolds
// (Phase 1 API-first pass): real routes, full Swagger docs, trivial
// request validation, but every handler returns 501 via
// handleNotImplementedResponse until the actual service logic — models,
// queries, business rules — is built out module by module.
router.use(orderRoutes);
router.use(customerRoutes);
router.use(catalogRoutes);
router.use(garmentRoutes);
router.use(storeRoutes);
router.use(invoiceRoutes);

export default router;
