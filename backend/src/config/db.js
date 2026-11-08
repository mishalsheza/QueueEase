const mongoose = require("mongoose");

const connectDB = async () => {
  try {
    console.log("🔗 Connecting to MongoDB...");
    
    await mongoose.connect(process.env.MONGO_URI, {
      dbName: "queueease",
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