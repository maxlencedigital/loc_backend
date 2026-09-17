import express from "express";
import { AuthController } from "../Controllers/Auth.Controller.js";
import { AuditController } from "../Controllers/Audit.Controller.js";
import { HealthController } from "../Controllers/Health.Controller.js";
import { NotificationController } from "../Controllers/Notification.Controller.js";
import { AccessPolicyController } from "../Controllers/AccessPolicy.Controller.js";
import { SecurityController } from "../Controllers/Security.Controller.js";
import { verifyToken, requireRole } from "../Middleware/Auth.js";
import { buildServiceProxy } from "../Middleware/ProxyRoutes.js";
import { authLimiter } from "../Middleware/RateLimiter.js";

const router = express.Router();

router.get("/health", HealthController.check);

// --------------------------- Auth ---------------------------
// authLimiter is deliberately far tighter than the general API rate
// limit — a login/register endpoint is a brute-force target the rest
// of the API isn't.
router.post("/auth/register", authLimiter, AuthController.register);
router.post("/auth/login", authLimiter, AuthController.login);
router.post("/auth/refresh", authLimiter, AuthController.refresh);
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

// --------------- Routing to the module services ----------------
// Every request below is authenticated once, here, before it
// ever reaches commerce/logistics/finance/growth.
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
