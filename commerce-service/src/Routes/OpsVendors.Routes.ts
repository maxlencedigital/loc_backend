// @generated-scaffold — contract scaffold from the API catalogue; handlers answer 501 until built.
// Once you implement a handler, delete the first line so regeneration can never overwrite your work.
import express from "express";
import { OpsVendorsController } from "../Controllers/OpsVendors.Controller.js";
import { requireIdentity, requireRole } from "../Middleware/Identity.js";

const router = express.Router();

const asAdminHrManagerStaff = [requireIdentity, requireRole("admin", "hr", "manager", "staff")];
const asHr = [requireIdentity, requireRole("admin", "hr")];
const asHrOrManager = [requireIdentity, requireRole("admin", "hr", "manager")];

router.get("/operations/materials", ...asAdminHrManagerStaff, OpsVendorsController.listMaterials);
router.post("/operations/materials", ...asHr, OpsVendorsController.createMaterial);
router.get("/operations/materials/:id", ...asAdminHrManagerStaff, OpsVendorsController.getMaterial);
router.patch("/operations/materials/:id", ...asHr, OpsVendorsController.updateMaterial);
router.get("/operations/purchase/requirements", ...asHrOrManager, OpsVendorsController.getPurchaseRequirements);
router.get("/operations/purchase/spend", ...asHr, OpsVendorsController.getPurchaseSpend);
router.post("/operations/purchase-orders", ...asHr, OpsVendorsController.createPurchaseOrder);
router.get("/operations/purchase-orders", ...asHrOrManager, OpsVendorsController.listPurchaseOrders);
router.get("/operations/purchase-orders/:id", ...asHrOrManager, OpsVendorsController.getPurchaseOrder);
router.patch("/operations/purchase-orders/:id", ...asHr, OpsVendorsController.updatePurchaseOrder);
router.post("/operations/purchase-orders/:id/cancel", ...asHr, OpsVendorsController.cancelPurchaseOrder);
router.post("/operations/purchase-orders/:id/receive", ...asHrOrManager, OpsVendorsController.receivePurchaseOrder);
router.post("/operations/purchase-orders/:id/send", ...asHr, OpsVendorsController.sendPurchaseOrder);
router.get("/operations/vendors", ...asHrOrManager, OpsVendorsController.listVendors);
router.post("/operations/vendors", ...asHr, OpsVendorsController.createVendor);
router.get("/operations/vendors/:id", ...asHrOrManager, OpsVendorsController.getVendor);
router.patch("/operations/vendors/:id", ...asHr, OpsVendorsController.updateVendor);
router.post("/operations/vendors/:id/agreements", ...asHr, OpsVendorsController.createVendorAgreement);
router.get("/operations/vendors/:id/agreements", ...asHrOrManager, OpsVendorsController.listVendorAgreements);
router.post("/operations/vendors/:id/agreements/:agreementId/document", ...asHr, OpsVendorsController.uploadVendorAgreementDocument);
router.post("/operations/vendors/:id/deactivate", ...asHr, OpsVendorsController.deactivateVendor);
router.get("/operations/vendors/:id/history", ...asHrOrManager, OpsVendorsController.getVendorHistory);

export default router;
