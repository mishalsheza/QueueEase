const cors = require("cors");
const rateLimit = require("express-rate-limit");

/**
 * CORS from an allowlist. Requests without an Origin header (the native app,
 * curl, server-to-server) are allowed: CORS is a browser protection, and
 * those clients still need a valid JWT for anything but the health check.
 * A browser origin that isn't listed gets no CORS headers, so the browser
 * blocks the response.
 */
const corsFromAllowlist = (origins) => {
  const allowed = new Set(origins);
  return cors({
    origin: (origin, cb) => cb(null, !origin || allowed.has(origin)),
    credentials: true,
  });
};

const tooMany = (req, res) =>
  res.status(429).json({ message: "Too many attempts, please try again later", code: "RATE_LIMITED" });

/**
 * Per-IP limits on the auth endpoints:
 *   login     counts failed attempts only, so a user who gets in isn't penalised
 *   register  counts every attempt (stops mass account creation)
 * Responses carry RateLimit-* headers (and Retry-After when limited).
 * The counters are in memory: per process, reset on restart. Several
 * instances would need a shared store (e.g. Redis).
 */
const authLimiters = ({ max, windowMs }) => {
  const base = { windowMs, limit: max, standardHeaders: "draft-7", legacyHeaders: false, handler: tooMany };
  return {
    login: rateLimit({ ...base, skipSuccessfulRequests: true }),
    register: rateLimit(base),
  };
};

module.exports = { corsFromAllowlist, authLimiters };
