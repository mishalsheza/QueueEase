// server.js
require("dotenv").config();
const { loadConfig } = require("./config/env");

// Fail at startup, listing every problem, rather than on the first request.
const { config, errors } = loadConfig();
if (errors.length > 0) {
  console.error("❌ Invalid configuration (see backend/.env):");
  errors.forEach((e) => console.error(`   - ${e}`));
  process.exit(1);
}

const http = require("http");
const { attachSocket } = require("./realtime/socket");
const app = require("./app");
const connectDB = require("./config/db");

// Connect to DB FIRST, then start server
async function startServer() {
  try {
    await connectDB(); // logs the database name and host

    // Create HTTP server
    const server = http.createServer(app);

    // Socket.io: authenticated, rooms by entitlement (see realtime/socket.js).
    // Same allowlist as REST (CORS_ORIGINS).
    const io = attachSocket(server, { corsOrigins: config.corsOrigins });
    app.set("io", io); // routes publish updates through it

    // Routes, 404 and error handling are registered in app.js.
    const PORT = config.port;
    server.listen(PORT, () => {
      console.log(`🚀 Server running on http://localhost:${PORT}`);
    });
    
  } catch (error) {
    console.error("❌ Failed to start server:", error);
    process.exit(1);
  }
}

// Safety net: route errors are handled by errorHandler, so reaching these
// means a bug outside a request (e.g. a socket handler). Log, then exit so a
// process manager restarts us in a clean state.
process.on("unhandledRejection", (reason) => {
  console.error("❌ Unhandled promise rejection:", reason);
  process.exit(1);
});

startServer();