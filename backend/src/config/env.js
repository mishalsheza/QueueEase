/**
 * Reads and checks the environment once, at startup. server.js calls
 * loadConfig() before anything else and exits with every problem listed if
 * the configuration is invalid, rather than failing later on the first
 * request. (This replaces the MONGO_URI / JWT_SECRET check added in A6.)
 *
 * Required
 *   MONGO_URI      MongoDB connection string
 *   JWT_SECRET     at least 32 characters
 *   CORS_ORIGINS   comma-separated browser origins allowed to call the API and
 *                  open sockets, e.g. "http://localhost:8081,https://app.example.com"
 * Optional
 *   PORT                      default 5001
 *   AUTH_RATE_LIMIT_MAX       login/register attempts per IP per window, default 20
 *   AUTH_RATE_LIMIT_WINDOW_MIN window length in minutes, default 15
 *   TRUST_PROXY               "1" when behind one reverse proxy (so rate limits
 *                             see the client IP, not the proxy's)
 */
const MIN_JWT_SECRET_LENGTH = 32;

/** "http://host[:port]" or "https://..." with no path, query or trailing slash. */
function isOrigin(value) {
  try {
    const u = new URL(value);
    return (u.protocol === "http:" || u.protocol === "https:") && u.origin === value;
  } catch {
    return false;
  }
}

function parseOrigins(raw) {
  return String(raw || "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
}

function positiveInt(raw, fallback) {
  if (raw === undefined || raw === "") return { value: fallback };
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? { value: n } : { error: true };
}

/**
 * Returns { config, errors }. `errors` lists every problem (names only, never
 * values, so secrets don't end up in logs).
 */
function loadConfig(env = process.env) {
  const errors = [];

  if (!env.MONGO_URI) errors.push("MONGO_URI is not set");

  if (!env.JWT_SECRET) errors.push("JWT_SECRET is not set");
  else if (env.JWT_SECRET.length < MIN_JWT_SECRET_LENGTH) {
    errors.push(`JWT_SECRET must be at least ${MIN_JWT_SECRET_LENGTH} characters (it has ${env.JWT_SECRET.length})`);
  }

  const corsOrigins = parseOrigins(env.CORS_ORIGINS);
  if (corsOrigins.length === 0) {
    errors.push('CORS_ORIGINS is not set (comma-separated origins, e.g. "http://localhost:8081")');
  } else {
    const bad = corsOrigins.filter((o) => !isOrigin(o));
    if (bad.length) {
      errors.push(`CORS_ORIGINS has invalid origins: ${bad.join(", ")} (use scheme://host[:port], no path or trailing slash, no "*")`);
    }
  }

  const port = positiveInt(env.PORT, 5001);
  if (port.error) errors.push("PORT must be a positive whole number");
  const max = positiveInt(env.AUTH_RATE_LIMIT_MAX, 20);
  if (max.error) errors.push("AUTH_RATE_LIMIT_MAX must be a positive whole number");
  const windowMin = positiveInt(env.AUTH_RATE_LIMIT_WINDOW_MIN, 15);
  if (windowMin.error) errors.push("AUTH_RATE_LIMIT_WINDOW_MIN must be a positive whole number");

  return {
    errors,
    config: {
      mongoUri: env.MONGO_URI,
      jwtSecret: env.JWT_SECRET,
      corsOrigins,
      port: port.value,
      authRateLimit: { max: max.value, windowMs: (windowMin.value || 15) * 60 * 1000 },
      trustProxy: env.TRUST_PROXY === "1",
    },
  };
}

module.exports = { loadConfig, parseOrigins, isOrigin, MIN_JWT_SECRET_LENGTH };
