// @generated-scaffold — contract scaffold from the API catalogue; handlers answer 501 until built.
// Once you implement a handler, delete the first line so regeneration can never overwrite your work.
import express from "express";
import { StoreComplaintsController } from "../Controllers/StoreComplaints.Controller.js";
import { requireIdentity, requireRole } from "../Middleware/Identity.js";

const router = express.Router();

const asStore = [requireIdentity, requireRole("admin", "manager", "staff")];

router.post("/complaints", ...asStore, StoreComplaintsController.logComplaint);
router.get("/complaints", ...asStore, StoreComplaintsController.listComplaints);
router.get("/complaints/:id", ...asStore, StoreComplaintsController.getComplaint);
router.post("/complaints/:id/assign", ...asStore, StoreComplaintsController.assignComplaint);
router.post("/complaints/:id/comments", ...asStore, StoreComplaintsController.commentOnComplaint);
router.post("/complaints/:id/escalate", ...asStore, StoreComplaintsController.escalateComplaint);
router.post("/complaints/:id/resolve", ...asStore, StoreComplaintsController.resolveComplaint);

export default router;
