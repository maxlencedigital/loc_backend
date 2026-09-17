import express from "express";
import { CatalogController } from "../Controllers/Catalog.Controller.js";
import { requireIdentity, requireRole } from "../Middleware/Identity.js";

const router = express.Router();

router.use(requireIdentity, requireRole("admin", "staff"));

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

router.post("/price-lists", CatalogController.createPriceList);
router.get("/price-lists", CatalogController.listPriceLists);
router.get("/price-lists/:id", CatalogController.getPriceList);
router.patch("/price-lists/:id", CatalogController.updatePriceList);
router.delete("/price-lists/:id", CatalogController.deletePriceList);

export default router;
