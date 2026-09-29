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

// Contract-only scaffolds: real routes and full Swagger docs, but every handler
// returns 501 until the service logic is built out module by module.
router.use(orderRoutes);
router.use(customerRoutes);
router.use(catalogRoutes);
router.use(garmentRoutes);
router.use(storeRoutes);
router.use(invoiceRoutes);

export default router;
