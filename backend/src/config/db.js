const mongoose = require("mongoose");

// One database name for the server and every script. seed_db.js and
// check_db.js used to connect without it and silently used "test".
const DB_NAME = "queueease";

const connectDB = async () => {
  try {
    console.log("🔗 Connecting to MongoDB...");
    
    await mongoose.connect(process.env.MONGO_URI, {
      dbName: DB_NAME,
    });
    
    console.log("✅ MongoDB connected successfully");
    console.log(`📊 Database: ${mongoose.connection.db.databaseName}`);
    console.log(`📍 Host: ${mongoose.connection.host}`);
    
    return mongoose.connection;
    
  } catch (error) {
    console.error("❌ MongoDB connection failed:", error.message);
    throw error; // Important: re-throw the error
  }
};

module.exports = connectDB;
module.exports.DB_NAME = DB_NAME;