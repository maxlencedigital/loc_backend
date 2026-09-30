// @generated-scaffold — contract scaffold from the API catalogue; handlers answer 501 until built.
// Once you implement a handler, delete the first line so regeneration can never overwrite your work.
import express from "express";
import { AdminCashController } from "../Controllers/AdminCash.Controller.js";
import { requireIdentity, requireRole } from "../Middleware/Identity.js";

const router = express.Router();

const asManager = [requireIdentity, requireRole("admin", "manager")];
const asAdmin = [requireIdentity, requireRole("admin")];

router.get("/cash/daily", ...asManager, AdminCashController.getDailyCash);
router.get("/cash/variances", ...asManager, AdminCashController.listCashVariances);
router.post("/cash/variances/:id/resolve", ...asAdmin, AdminCashController.resolveCashVariance);
router.get("/daily-close", ...asManager, AdminCashController.listDailyCloses);
router.get("/daily-close/:id", ...asManager, AdminCashController.getDailyClose);
router.post("/daily-close/:id/approve", ...asAdmin, AdminCashController.approveDailyClose);

export default router;
