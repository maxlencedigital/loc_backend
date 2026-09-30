import express from "express";
import { buildServiceProxy } from "../Middleware/ProxyRoutes.js";
import { apiLimiter } from "../Middleware/RateLimiter.js";
import { activityLogger } from "../Middleware/ActivityLogger.js";

// The one convention for endpoints that need no token: <service>/public/*.
// Everything else under /<service>/ requires a JWT. Each service's own routes
// enforce the mirror rule: a route is public if and only if it lives under /public/.
export const buildPublicRouter = (targets: Record<string, string>) => {
  const router = express.Router();
  for (const [service, target] of Object.entries(targets)) {
    router.use(
      `/${service}/public`,
      apiLimiter,
      activityLogger("gateway-service"),
      buildServiceProxy(target, `/${service}`)
    );
  }
  return router;
};

export default buildPublicRouter({
  commerce: process.env.COMMERCE_SERVICE_URL || "http://localhost:5001",
  logistics: process.env.LOGISTICS_SERVICE_URL || "http://localhost:5002",
  finance: process.env.FINANCE_SERVICE_URL || "http://localhost:5003",
  growth: process.env.GROWTH_SERVICE_URL || "http://localhost:5004",
});
