import express from "express";
import { AuthAccountController } from "../Controllers/AuthAccount.Controller.js";
import { verifyToken, requireRole, optionalToken } from "../Middleware/Auth.js";
import { accountLimiter, authLimiter } from "../Middleware/RateLimiter.js";

// Started as a catalogue scaffold; hand-maintained now (POST /auth/2fa/verify is dual-mode and
// the limiters differ per route), so the generator must not overwrite it.
const router = express.Router();

const asHrOrManager = [verifyToken, requireRole("admin", "hr", "manager")];
const asEveryone = [verifyToken, requireRole("admin", "hr", "manager", "staff", "driver", "customer")];

router.post("/auth/2fa/disable", ...asHrOrManager, accountLimiter, AuthAccountController.disableTwoFactor);
router.post("/auth/2fa/enable", ...asHrOrManager, accountLimiter, AuthAccountController.enableTwoFactor);
// Public on purpose: it also completes a sign-in, when no token exists yet. With a Bearer token it
// is the enrolment confirmation (role checked in the service); without one only a signed challenge works.
router.post("/auth/2fa/verify", authLimiter, optionalToken, AuthAccountController.verifyTwoFactor);
router.post("/auth/invite/accept", authLimiter, AuthAccountController.acceptInvite);
router.post("/auth/logout", ...asEveryone, AuthAccountController.logout);
router.get("/auth/me", ...asEveryone, AuthAccountController.getMe);
router.patch("/auth/me", ...asEveryone, AuthAccountController.updateMe);
router.post("/auth/me/phone/send-otp", ...asEveryone, accountLimiter, AuthAccountController.sendPhoneChangeOtp);
router.post("/auth/me/phone/verify-otp", ...asEveryone, accountLimiter, AuthAccountController.verifyPhoneChangeOtp);
router.post("/auth/password/change", ...asEveryone, accountLimiter, AuthAccountController.changePassword);

export default router;
