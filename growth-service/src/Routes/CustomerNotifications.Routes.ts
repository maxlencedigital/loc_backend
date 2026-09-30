// @generated-scaffold — contract scaffold from the API catalogue; handlers answer 501 until built.
// Once you implement a handler, delete the first line so regeneration can never overwrite your work.
import express from "express";
import { CustomerNotificationsController } from "../Controllers/CustomerNotifications.Controller.js";
import { requireIdentity, requireRole } from "../Middleware/Identity.js";

const router = express.Router();

const asCustomer = [requireIdentity, requireRole("customer")];

router.get("/me/notification-preferences", ...asCustomer, CustomerNotificationsController.getMyNotificationPreferences);
router.put("/me/notification-preferences", ...asCustomer, CustomerNotificationsController.setMyNotificationPreferences);
router.get("/me/notifications", ...asCustomer, CustomerNotificationsController.listMyNotifications);
router.post("/me/notifications/:id/read", ...asCustomer, CustomerNotificationsController.markMyNotificationRead);

export default router;
