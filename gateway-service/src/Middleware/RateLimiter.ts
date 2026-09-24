import rateLimit, { Store } from "express-rate-limit";
import { RequestHandler } from "express";
import { redisClient } from "../../commons/Cache/RedisClient.js";
import { RedisRateLimitStore } from "./RedisRateLimitStore.js";

/**
 * Off during development, on in production.
 *
 * Rate limiting is a genuine nuisance while building — an afternoon of
 * hitting an endpoint trips the limit and then you're debugging a 429 that
 * isn't a real bug. But deleting it outright is how a service reaches
 * production with no brute-force protection at all, so it's a switch rather
 * than a removal: unset in dev (off), and on by default under NODE_ENV=
 * production without anyone having to remember to re-enable it.
 *
 * Set RATE_LIMIT_ENABLED=true locally to exercise the real behaviour.
 */
const rateLimitingEnabled =
  process.env.RATE_LIMIT_ENABLED === "true" ||
  (process.env.RATE_LIMIT_ENABLED === undefined && process.env.NODE_ENV === "production");

/** Does nothing, so call sites stay identical whether limiting is on or off. */
const passthrough: RequestHandler = (_req, _res, next) => next();

/**
 * Counters live in Redis when it's available, shared by every instance.
 *
 * express-rate-limit's default MemoryStore keeps counters per process, which
 * quietly breaks the limit the moment there's more than one instance: with N
 * instances behind a load balancer the effective limit becomes N x max, and
 * every deploy resets all counters. For the general API limiter that's merely
 * sloppy; for the login limiter it means the brute-force protection weakens
 * exactly as you scale up.
 *
 * Falls back to the in-memory store when REDIS_URL isn't set, so local runs
 * and tests need no Redis — the limit is then per-process, which is correct
 * for a single process.
 */
const buildStore = (prefix: string): Store | undefined =>
  redisClient ? new RedisRateLimitStore(prefix) : undefined;

/**
 * General API traffic — generous, just a backstop against abuse.
 */
const apiLimiter: RequestHandler = !rateLimitingEnabled
  ? passthrough
  : rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  store: buildStore("rl:api:"),
  // Fail OPEN. Without this, a Redis outage makes the store throw and
  // express-rate-limit turns that into a 500 on every single route —
  // including /health, so the container is marked unhealthy and restarts.
  // A cache/counter outage must not be able to take the platform down;
  // serving unthrottled for the duration is the lesser evil.
  passOnStoreError: true,
});

/**
 * /auth/login and /auth/register specifically. 300 req/15min (the
 * general limiter) is a workable brute-force budget against a login
 * endpoint — this is deliberately much tighter, and keyed by IP+email
 * so one attacker can't lock out a real user's email by spamming
 * failed logins from many IPs, and one NAT/office IP with many real
 * users isn't punished for a single bad actor on it.
 */
const authLimiter: RequestHandler = !rateLimitingEnabled
  ? passthrough
  : rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  // Key on IP + route + whichever identifier this particular flow carries.
  //
  // Keying on `ip:email` alone was wrong: OAuth and OTP-verify requests have
  // no email in the body, so every one of them collapsed into a single
  // `ip:` bucket. Behind a corporate NAT or carrier-grade NAT that means ten
  // combined social logins and OTP verifications — across all users sharing
  // that address — locked everyone out for 15 minutes.
  //
  // Including the path keeps flows independent too, so failed social logins
  // can't burn the password-login budget for the same person.
  keyGenerator: (req) => {
    const body = req.body ?? {};
    const identifier =
      (body.email && String(body.email).toLowerCase()) ||
      body.phoneNumber ||
      // Verify/reset calls carry no account identifier, only the opaque
      // challenge id — which is per-attempt and exactly the right grain.
      body.verificationId ||
      "anonymous";
    return `${req.ip}:${req.path}:${identifier}`;
  },
  store: buildStore("rl:auth:"),
  // Also fails open, which is a deliberate trade-off worth understanding:
  // during a Redis outage brute-force throttling is gone, but failing closed
  // would mean nobody can log in at all. A guaranteed total login outage is
  // worse than a brief, narrow window of weakened throttling — especially as
  // bcrypt at cost factor 12 (~300ms per attempt) still caps how fast an
  // attacker can guess even with no limiter in front.
  // Revisit if Redis outages stop being rare.
  passOnStoreError: true,
  message: {
    statusCode: 429,
    result: null,
    displayMessage: "Too many attempts. Try again later.",
    status: false,
  },
});

export { apiLimiter, authLimiter };
