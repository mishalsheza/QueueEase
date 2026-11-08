// server.js
require("dotenv").config();
const http = require("http");
const { Server } = require("socket.io");
const app = require("./app"); // Import your Express app with CORS already configured
const connectDB = require("./config/db");

console.log("🔧 Starting server initialization...");

// Connect to DB FIRST, then start server
async function startServer() {
  try {
    console.log("🔗 Connecting to MongoDB...");
    await connectDB();
    
    console.log("✅ MongoDB connected successfully");
    
    // Create HTTP server
    const server = http.createServer(app);

    // Initialize Socket.io
    const io = new Server(server, {
      cors: {
        origin: [
          'http://localhost:19006', // Expo web
          'http://localhost:19000', // Expo dev tools
          'http://localhost:5001', // Local server
          'http://10.51.4.119:19006', // Your IP for mobile
          'exp://10.51.4.119:19000', // Expo dev client
          "http://localhost:8081", // Android Emulator
          "http://10.0.2.2:5001", // Android Emulator localhost alias
        ],
        methods: ["GET", "POST"],
        credentials: true
      }
    });

    // Make io accessible to our router
    app.set("io", io);

    // Socket.io event handlers
    io.on("connection", (socket) => {
      console.log(`✅ New client connected: ${socket.id}`);

      socket.on("joinQueue", (queueId) => {
        socket.join(queueId);
        console.log(`Socket ${socket.id} joined queue: ${queueId}`);
      });

      socket.on("leaveQueue", (queueId) => {
        socket.leave(queueId);
        console.log(`Socket ${socket.id} left queue: ${queueId}`);
      });

      socket.on("disconnect", () => {
        console.log(`❌ Client disconnected: ${socket.id}`);
      });
    });
    
    // Now load routes AFTER DB is connected
    console.log("📂 Loading routes...");
    // Add this in server.js after CORS middleware but before other routes
    app.get("/cors-test", (req, res) => {
      res.json({
        message: "CORS test endpoint",
        origin: req.headers.origin,
        corsEnabled: true,
        timestamp: new Date().toISOString()
      });
    });
    
    // Auth routes
    const authRoutes = require("./routes/auth");
    app.use("/api/auth", authRoutes);
    console.log("✅ Auth routes loaded");
    
    // Queue routes
    const queueRoutes = require("./routes/queue");
    app.use("/api/queues", queueRoutes);
    console.log("✅ Queue routes loaded");
    
    const PORT = process.env.PORT || 5001;
    server.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`🌐 Test: http://localhost:${PORT}/test`);
      console.log(`🌐 Home: http://localhost:${PORT}/`);
      console.log(`🔐 Auth test: http://localhost:${PORT}/api/auth/test`);
      console.log(`🌐 Network: http://10.51.4.119:${PORT}`);
      console.log(`🌐 Expo Web: http://localhost:19006`);
    });
    
  } catch (error) {
    console.error("❌ Failed to start server:", error);
    process.exit(1);
  }
}

startServer();