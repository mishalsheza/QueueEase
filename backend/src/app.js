const express = require("express");
const helmet = require("helmet");
const mongoose = require("mongoose");
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
 * config: { corsOrigins, authRateLimit: { max, windowMs }, trustProxy (proxy hops, 0 = off) }
 */
function createApp(config) {
  const app = express();

  // req.ip = the X-Forwarded-For entry added by the outermost of `trustProxy`
  // proxies. Entries further left were sent by the client and are ignored.
  if (Number.isInteger(config.trustProxy) && config.trustProxy > 0) app.set("trust proxy", config.trustProxy);

  app.use(helmet()); // security headers; also removes X-Powered-By
  app.use(corsFromAllowlist(config.corsOrigins));
  app.use(express.json({ limit: "100kb" }));

  app.get("/", (req, res) => {
    res.send("QueueEase API running");
  });

  // Health check for Docker and load balancers: 200 only when the database is
  // connected, so a container that has lost MongoDB is reported unhealthy.
  app.get("/api/health", (req, res) => {
    const dbConnected = mongoose.connection.readyState === 1;
    res
      .status(dbConnected ? 200 : 503)
      .set("Cache-Control", "no-store")
      .json({ status: dbConnected ? "ok" : "unavailable", db: dbConnected ? "connected" : "disconnected" });
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
