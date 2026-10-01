import express from "express";
import { AuthController } from "../Controllers/Auth.Controller.js";
import { UserAuthController } from "../Controllers/UserAuth.Controller.js";
import { AuditController } from "../Controllers/Audit.Controller.js";
import { HealthController } from "../Controllers/Health.Controller.js";
import { NotificationController } from "../Controllers/Notification.Controller.js";
import { AccessPolicyController } from "../Controllers/AccessPolicy.Controller.js";
import { SecurityController } from "../Controllers/Security.Controller.js";
import { verifyToken, requireRole } from "../Middleware/Auth.js";
import { buildServiceProxy } from "../Middleware/ProxyRoutes.js";
import { authLimiter } from "../Middleware/RateLimiter.js";
import usersRoutes from "./Users.Routes.js";
import generatedRoutes from "./Generated.Routes.js";

const router = express.Router();

router.get("/health", HealthController.check);

// --------------------------------- Auth ---------------------------------

// authLimiter is far tighter than the general API limit: a login endpoint is a
// brute-force target the rest of the API is not.
router.post("/auth/register", authLimiter, AuthController.register);
router.post("/auth/login", authLimiter, AuthController.login);
router.post("/auth/customer/login", authLimiter, AuthController.customerLogin);
router.post("/auth/refresh", authLimiter, AuthController.refresh);

// Customer-facing auth. OTP flows are additionally throttled per phone/email
// inside Otp.Service, so cycling IPs cannot spam one number or the SMS bill.
router.post("/auth/register/send-otp", authLimiter, UserAuthController.registerSendOtp);
router.post("/auth/register/verify-otp", authLimiter, UserAuthController.registerVerifyOtp);
router.post("/auth/register/complete", authLimiter, UserAuthController.registerComplete);
router.post("/auth/login/otp/request", authLimiter, UserAuthController.loginOtpRequest);
router.post("/auth/login/otp/verify", authLimiter, UserAuthController.loginOtpVerify);
router.post("/auth/login/oauth", authLimiter, UserAuthController.loginOAuth);
router.post("/auth/password/forgot", authLimiter, UserAuthController.passwordForgot);
router.post("/auth/password/reset", authLimiter, UserAuthController.passwordReset);
router.post(
  "/auth/admin-users",
  verifyToken,
  requireRole("super_admin"),
  AuthController.createPrivilegedUser
);

// -------------------------- Security --------------------------
router.get("/audit/logs", verifyToken, requireRole("admin"), AuditController.getLogs);
router.get(
  "/security/backup-status",
  verifyToken,
  requireRole("admin"),
  SecurityController.backupStatus
);

// ----------------------- Access Control -----------------------
router.post("/access-policies", verifyToken, requireRole("admin"), AccessPolicyController.create);
router.get("/access-policies", verifyToken, requireRole("admin"), AccessPolicyController.list);
router.get(
  "/access-policies/:id",
  verifyToken,
  requireRole("admin"),
  AccessPolicyController.getById
);
router.patch(
  "/access-policies/:id",
  verifyToken,
  requireRole("admin"),
  AccessPolicyController.update
);
router.delete(
  "/access-policies/:id",
  verifyToken,
  requireRole("admin"),
  AccessPolicyController.remove
);

// ------------------------ Notifications ------------------------
router.post(
  "/notifications/send",
  verifyToken,
  requireRole("admin", "staff"),
  NotificationController.send
);

// Hand-written and mounted first, so these win over the scaffolded routes they replace.
router.use(usersRoutes);

// Role-guarded contract scaffolds generated from the API catalogue.
router.use(generatedRoutes);

// --------------------- Routing to the module services ---------------------
// Every request below is authenticated once, here, before it reaches a service.
router.use(
  "/commerce",
  verifyToken,
  buildServiceProxy(process.env.COMMERCE_SERVICE_URL || "http://localhost:5001", "/commerce")
);
router.use(
  "/logistics",
  verifyToken,
  buildServiceProxy(process.env.LOGISTICS_SERVICE_URL || "http://localhost:5002", "/logistics")
);
router.use(
  "/finance",
  verifyToken,
  buildServiceProxy(process.env.FINANCE_SERVICE_URL || "http://localhost:5003", "/finance")
);
router.use(
  "/growth",
  verifyToken,
  buildServiceProxy(process.env.GROWTH_SERVICE_URL || "http://localhost:5004", "/growth")
);

export default router;
