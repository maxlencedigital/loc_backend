import rateLimit, { Store } from "express-rate-limit";
import { RequestHandler } from "express";
import { redisClient } from "../../commons/Cache/RedisClient.js";
import { RedisRateLimitStore } from "./RedisRateLimitStore.js";

// A switch rather than a removal: off in dev, on automatically under
// NODE_ENV=production. Set RATE_LIMIT_ENABLED=true locally to exercise it.
const rateLimitingEnabled =
  process.env.RATE_LIMIT_ENABLED === "true" ||
  (process.env.RATE_LIMIT_ENABLED === undefined && process.env.NODE_ENV === "production");

/** Does nothing, so call sites stay identical whether limiting is on or off. */
const passthrough: RequestHandler = (_req, _res, next) => next();

// Counters live in Redis so every instance shares them. The default
// MemoryStore is per-process, making the real limit N x max across N instances.
const buildStore = (prefix: string): Store | undefined =>
  redisClient ? new RedisRateLimitStore(prefix) : undefined;

// Keyed on the forwarded x-user-id, not req.ip: all traffic arrives from the
// gateway, so an IP-keyed limit would put every client in one bucket.
const apiLimiter: RequestHandler = !rateLimitingEnabled
  ? passthrough
  : rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 300,
      standardHeaders: true,
      legacyHeaders: false,
      keyGenerator: (req) => req.header("x-user-id") || req.ip || "unknown",
      store: buildStore("rl:api:"),
      // Fail OPEN: a Redis outage must not 500 every route, /health included,
      // which would mark the container unhealthy and restart it.
      passOnStoreError: true,
    });

export { apiLimiter };
