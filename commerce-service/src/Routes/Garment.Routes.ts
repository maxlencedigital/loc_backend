import express from "express";
import { GarmentController } from "../Controllers/Garment.Controller.js";
import { requireIdentity, requireRole } from "../Middleware/Identity.js";

const router = express.Router();

// Scoped to this router's own paths. An unscoped router.use() runs for EVERY request
// that reaches the commerce router, so it would block other roles' routes mounted later.
router.use(["/garments"], requireIdentity, requireRole("admin", "manager", "staff"));

router.post("/garments/:tagId/scan", GarmentController.scan);
router.post("/garments/:id/image", GarmentController.uploadImage);

export default router;
