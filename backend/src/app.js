const express = require("express");
const helmet = require("helmet");
const authRoutes = require("./routes/auth");
const queueRoutes = require("./routes/queue");
const { errorHandler, notFound } = require("./middleware/errorHandler");
const { corsFromAllowlist, authLimiters } = require("./middleware/security");
const { loadConfig } = require("./config/env");

/**
 * Builds the Express app without connecting to the DB or listening, so tests
 * can import it directly. server.js validates the environment, then does the
 * DB connection, Socket.io and listen.
 *
 * config: { corsOrigins, authRateLimit: { max, windowMs }, trustProxy }
 */
function createApp(config) {
  const app = express();

  if (config.trustProxy) app.set("trust proxy", 1); // client IP from X-Forwarded-For (one proxy)

  app.use(helmet()); // security headers; also removes X-Powered-By
  app.use(corsFromAllowlist(config.corsOrigins));
  app.use(express.json({ limit: "100kb" }));

  // Health check.
  app.get("/", (req, res) => {
    res.send("QueueEase API running");
  });

  const limit = authLimiters(config.authRateLimit);
  app.post("/api/auth/login", limit.login);
  app.post("/api/auth/register", limit.register);
  app.use("/api/auth", authRoutes);
  app.use("/api/queues", queueRoutes);

  // Must be registered after all routes.
  app.use(notFound);
  app.use(errorHandler);

  return app;
}

// Default instance from the environment. server.js has already exited if the
// environment is invalid; tests set their own values in tests/setupEnv.js.
const app = createApp(loadConfig().config);

module.exports = app;
module.exports.createApp = createApp;
