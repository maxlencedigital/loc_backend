// @generated-scaffold — contract scaffold from the API catalogue; handlers answer 501 until built.
// Once you implement a handler, delete the first line so regeneration can never overwrite your work.
import express from "express";
import { AdminCampaignsController } from "../Controllers/AdminCampaigns.Controller.js";
import { requireIdentity, requireRole } from "../Middleware/Identity.js";

const router = express.Router();

const asAdmin = [requireIdentity, requireRole("admin")];

router.get("/campaigns", ...asAdmin, AdminCampaignsController.listCampaigns);
router.post("/campaigns", ...asAdmin, AdminCampaignsController.createCampaign);
router.post("/campaigns/audience-preview", ...asAdmin, AdminCampaignsController.previewCampaignAudience);
router.get("/campaigns/:id", ...asAdmin, AdminCampaignsController.getCampaign);
router.patch("/campaigns/:id", ...asAdmin, AdminCampaignsController.updateCampaign);
router.post("/campaigns/:id/cancel", ...asAdmin, AdminCampaignsController.cancelCampaign);
router.post("/campaigns/:id/schedule", ...asAdmin, AdminCampaignsController.scheduleCampaign);
router.post("/campaigns/:id/send", ...asAdmin, AdminCampaignsController.sendCampaign);
router.get("/campaigns/:id/stats", ...asAdmin, AdminCampaignsController.getCampaignStats);
router.get("/notification-templates", ...asAdmin, AdminCampaignsController.listNotificationTemplates);
router.post("/notification-templates", ...asAdmin, AdminCampaignsController.createNotificationTemplate);
router.get("/notification-templates/:id", ...asAdmin, AdminCampaignsController.getNotificationTemplate);
router.patch("/notification-templates/:id", ...asAdmin, AdminCampaignsController.updateNotificationTemplate);
router.delete("/notification-templates/:id", ...asAdmin, AdminCampaignsController.deleteNotificationTemplate);
router.get("/notifications", ...asAdmin, AdminCampaignsController.listNotificationLog);
router.get("/notifications/:id", ...asAdmin, AdminCampaignsController.getNotificationLogEntry);
router.post("/notifications/:id/retry", ...asAdmin, AdminCampaignsController.retryNotification);

export default router;
