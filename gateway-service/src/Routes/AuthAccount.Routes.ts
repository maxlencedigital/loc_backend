// @generated-scaffold — contract scaffold from the API catalogue; handlers answer 501 until built.
// Once you implement a handler, delete the first line so regeneration can never overwrite your work.
import express from "express";
import { AuthAccountController } from "../Controllers/AuthAccount.Controller.js";
import { verifyToken, requireRole } from "../Middleware/Auth.js";
import { authLimiter } from "../Middleware/RateLimiter.js";

const router = express.Router();

const asHrOrManager = [verifyToken, requireRole("admin", "hr", "manager")];
const asEveryone = [verifyToken, requireRole("admin", "hr", "manager", "staff", "driver", "customer")];

router.post("/auth/2fa/disable", ...asHrOrManager, AuthAccountController.disableTwoFactor);
router.post("/auth/2fa/enable", ...asHrOrManager, AuthAccountController.enableTwoFactor);
router.post("/auth/2fa/verify", ...asHrOrManager, AuthAccountController.verifyTwoFactor);
router.post("/auth/invite/accept", authLimiter, AuthAccountController.acceptInvite);
router.post("/auth/logout", ...asEveryone, AuthAccountController.logout);
router.get("/auth/me", ...asEveryone, AuthAccountController.getMe);
router.patch("/auth/me", ...asEveryone, AuthAccountController.updateMe);
router.post("/auth/me/phone/send-otp", ...asEveryone, AuthAccountController.sendPhoneChangeOtp);
router.post("/auth/me/phone/verify-otp", ...asEveryone, AuthAccountController.verifyPhoneChangeOtp);
router.post("/auth/password/change", ...asEveryone, AuthAccountController.changePassword);

export default router;
