// server.js
require("dotenv").config();
const http = require("http");
const { attachSocket } = require("./realtime/socket");
const app = require("./app"); // Import your Express app with CORS already configured
const connectDB = require("./config/db");

// Fail at startup rather than on the first login.
for (const name of ["MONGO_URI", "JWT_SECRET"]) {
  if (!process.env[name]) {
    console.error(`❌ ${name} is not set (see backend/.env)`);
    process.exit(1);
  }
}

// Connect to DB FIRST, then start server
async function startServer() {
  try {
    await connectDB(); // logs the database name and host

    // Create HTTP server
    const server = http.createServer(app);

    // Socket.io: authenticated, rooms by entitlement (see realtime/socket.js).
    const io = attachSocket(server, {
      corsOrigins: [
        "http://localhost:19006", // Expo web (legacy port)
        "http://localhost:19000", // Expo dev tools
        "http://localhost:8081", // Expo web / Metro
        "http://10.51.4.119:19006", // LAN IP for devices
        "exp://10.51.4.119:19000", // Expo dev client
        "http://10.0.2.2:5001", // Android emulator alias for localhost
      ],
    });
    app.set("io", io); // routes publish updates through it

    // Routes, 404 and error handling are registered in app.js.
    const PORT = process.env.PORT || 5001;
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