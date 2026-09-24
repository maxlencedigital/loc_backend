import rateLimit, { Store } from "express-rate-limit";
import { RequestHandler } from "express";
import { redisClient } from "../../commons/Cache/RedisClient.js";
import { RedisRateLimitStore } from "./RedisRateLimitStore.js";

/**
 * Off during development, on in production.
 *
 * Rate limiting gets in the way while building — an afternoon of hitting an
 * endpoint trips the limit and then you are debugging a 429 that is not a
 * real bug. Deleting it outright is how a service reaches production with no
 * abuse protection at all, so this is a switch rather than a removal: unset
 * in dev (off), on by default under NODE_ENV=production without anyone
 * having to remember to re-enable it.
 *
 * Set RATE_LIMIT_ENABLED=true locally to exercise the real behaviour.
 */
const rateLimitingEnabled =
  process.env.RATE_LIMIT_ENABLED === "true" ||
  (process.env.RATE_LIMIT_ENABLED === undefined && process.env.NODE_ENV === "production");

/** Does nothing, so call sites stay identical whether limiting is on or off. */
const passthrough: RequestHandler = (_req, _res, next) => next();

/**
 * Counters live in Redis when it's available, shared by every instance of
 * this service. express-rate-limit's default MemoryStore is per-process, so
 * with N instances behind the gateway the effective limit silently becomes
 * N x max, and every deploy resets it.
 */
const buildStore = (prefix: string): Store | undefined =>
  redisClient ? new RedisRateLimitStore(prefix) : undefined;

/**
 * All traffic here comes from the gateway, so req.ip is always the
 * gateway's own address — an IP-keyed limit would put every real
 * client in one shared bucket. Key by the forwarded x-user-id instead.
 */
const apiLimiter: RequestHandler = !rateLimitingEnabled
  ? passthrough
  : rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 300,
      standardHeaders: true,
      legacyHeaders: false,
      keyGenerator: (req) => req.header("x-user-id") || req.ip || "unknown",
      store: buildStore("rl:api:"),
      // Fail OPEN — a Redis outage must not turn into a 500 on every route
      // (including /health, which would mark the container unhealthy and
      // restart it). Serving unthrottled beats serving nothing.
      passOnStoreError: true,
    });

export { apiLimiter };
