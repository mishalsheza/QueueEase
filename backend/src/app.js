const express = require("express");
const cors = require("cors");
const authRoutes = require("./routes/auth");
const queueRoutes = require("./routes/queue");
const { errorHandler, notFound } = require("./middleware/errorHandler");

/**
 * Builds the Express app without connecting to the DB or listening, so tests
 * can import it directly. server.js does the DB connection, Socket.io and listen.
 */
const app = express();

// NOTE: CORS is still wide open; restricting it via env is a later plan item.
app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("QueueEase API running");
});

// Debug route kept as-is for now; removal is a later plan item (A6).
app.get("/cors-test", (req, res) => {
  res.json({
    message: "CORS test endpoint",
    origin: req.headers.origin,
    corsEnabled: true,
    timestamp: new Date().toISOString(),
  });
});

app.use("/api/auth", authRoutes);
app.use("/api/queues", queueRoutes);

// Must be registered after all routes.
app.use(notFound);
app.use(errorHandler);

module.exports = app;
