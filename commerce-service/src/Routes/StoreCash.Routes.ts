// @generated-scaffold — contract scaffold from the API catalogue; handlers answer 501 until built.
// Once you implement a handler, delete the first line so regeneration can never overwrite your work.
import express from "express";
import { StoreCashController } from "../Controllers/StoreCash.Controller.js";
import { requireIdentity, requireRole } from "../Middleware/Identity.js";

const router = express.Router();

const asStore = [requireIdentity, requireRole("admin", "manager", "staff")];
const asManager = [requireIdentity, requireRole("admin", "manager")];

router.post("/stores/:id/cash/counts", ...asStore, StoreCashController.countCash);
router.get("/stores/:id/cash/counts", ...asStore, StoreCashController.listCashCounts);
router.post("/stores/:id/cash/deposits", ...asStore, StoreCashController.recordCashDeposit);
router.get("/stores/:id/cash/deposits", ...asStore, StoreCashController.listCashDeposits);
router.get("/stores/:id/cash/variances", ...asStore, StoreCashController.listStoreCashVariances);
router.post("/stores/:id/day/close", ...asManager, StoreCashController.closeStoreDay);
router.get("/stores/:id/day/status", ...asStore, StoreCashController.getStoreDayStatus);

export default router;
