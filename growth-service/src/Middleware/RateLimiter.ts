import rateLimit from "express-rate-limit";

/**
 * All traffic here comes from the gateway, so req.ip is always the
 * gateway's own address — an IP-keyed limit would put every real
 * client in one shared bucket. Key by the forwarded x-user-id instead
 * (falls back to IP for the small number of routes that don't require
 * identity, e.g. none currently besides /health, which isn't gated).
 */
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.header("x-user-id") || req.ip || "unknown",
});

export { apiLimiter };
