import express from "express";
import { GarmentController } from "../Controllers/Garment.Controller.js";
import { requireIdentity, requireRole } from "../Middleware/Identity.js";

const router = express.Router();

router.use(requireIdentity, requireRole("admin", "staff"));

router.post("/garments/:tagId/scan", GarmentController.scan);
router.post("/garments/:id/image", GarmentController.uploadImage);

export default router;
