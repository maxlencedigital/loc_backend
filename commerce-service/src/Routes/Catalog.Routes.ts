import express from "express";
import { CatalogController } from "../Controllers/Catalog.Controller.js";
import { requireIdentity, requireRole } from "../Middleware/Identity.js";

const router = express.Router();

// Scoped to this router's own paths. An unscoped router.use() runs for EVERY request
// that reaches the commerce router, so it would block other roles' routes mounted later.
router.use(["/services", "/garment-types", "/price-lists"], requireIdentity, requireRole("admin", "manager", "staff"));

router.post("/services", CatalogController.createService);
router.get("/services", CatalogController.listServices);
router.get("/services/:id", CatalogController.getService);
router.patch("/services/:id", CatalogController.updateService);
router.delete("/services/:id", CatalogController.deleteService);

router.post("/garment-types", CatalogController.createGarmentType);
router.get("/garment-types", CatalogController.listGarmentTypes);
router.get("/garment-types/:id", CatalogController.getGarmentType);
router.patch("/garment-types/:id", CatalogController.updateGarmentType);
router.delete("/garment-types/:id", CatalogController.deleteGarmentType);

router.post("/price-lists", requireRole("admin"), CatalogController.createPriceList);
router.get("/price-lists", CatalogController.listPriceLists);
router.get("/price-lists/:id", CatalogController.getPriceList);
router.get("/price-lists/:id/rows", CatalogController.listPriceRows);
router.patch("/price-lists/:id", requireRole("admin"), CatalogController.updatePriceList);
router.post("/price-lists/:id/duplicate", requireRole("admin"), CatalogController.duplicatePriceList);
router.put("/price-lists/:id/rows/:rowId", requireRole("admin"), CatalogController.updatePriceRow);
router.delete("/price-lists/:id", CatalogController.deletePriceList);

export default router;
