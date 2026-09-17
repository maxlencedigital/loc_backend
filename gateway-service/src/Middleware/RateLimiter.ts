import rateLimit from "express-rate-limit";

/**
 * General API traffic — generous, just a backstop against abuse.
 */
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * /auth/login and /auth/register specifically. 300 req/15min (the
 * general limiter) is a workable brute-force budget against a login
 * endpoint — this is deliberately much tighter, and keyed by IP+email
 * so one attacker can't lock out a real user's email by spamming
 * failed logins from many IPs, and one NAT/office IP with many real
 * users isn't punished for a single bad actor on it.
 */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `${req.ip}:${(req.body?.email || "").toLowerCase()}`,
  message: {
    statusCode: 429,
    result: null,
    displayMessage: "Too many attempts. Try again later.",
    status: false,
  },
});

export { apiLimiter, authLimiter };
