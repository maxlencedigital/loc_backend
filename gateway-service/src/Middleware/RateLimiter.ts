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
// MemoryStore is per-process, so across N instances the real limit becomes
// N x max — which weakens brute-force protection exactly as you scale up.
const buildStore = (prefix: string): Store | undefined =>
  redisClient ? new RedisRateLimitStore(prefix) : undefined;

/** General API traffic — generous, just a backstop against abuse. */
const apiLimiter: RequestHandler = !rateLimitingEnabled
  ? passthrough
  : rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 300,
      standardHeaders: true,
      legacyHeaders: false,
      store: buildStore("rl:api:"),
      // Fail OPEN: a Redis outage must not 500 every route, /health included,
      // which would mark the container unhealthy and restart it.
      passOnStoreError: true,
    });

// Auth routes specifically: 300/15min is no brute-force budget for a login
// endpoint, so this is far tighter.
const authLimiter: RequestHandler = !rateLimitingEnabled
  ? passthrough
  : rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 10,
      standardHeaders: true,
      legacyHeaders: false,
      // Keyed on IP + route + whichever identifier the flow carries. Keying on
      // `ip:email` alone collapsed every OAuth and OTP-verify request — which
      // carry no email — into one bucket per IP, locking out everyone behind a
      // NAT after ten combined attempts. The path keeps flows independent too.
      keyGenerator: (req) => {
        const body = req.body ?? {};
        const identifier =
          (body.email && String(body.email).toLowerCase()) ||
          body.phoneNumber ||
          // Verify/reset carry only the opaque challenge id, which is
          // per-attempt and exactly the right grain.
          body.verificationId ||
          "anonymous";
        return `${req.ip}:${req.path}:${identifier}`;
      },
      store: buildStore("rl:auth:"),
      // Also fails open: failing closed during a Redis outage would mean nobody
      // can log in at all, and bcrypt at cost 12 (~300ms) still caps guessing.
      passOnStoreError: true,
      message: {
        statusCode: 429,
        result: null,
        displayMessage: "Too many attempts. Try again later.",
        status: false,
      },
    });

export { apiLimiter, authLimiter };
