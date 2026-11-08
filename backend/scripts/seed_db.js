const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const User = require("../src/models/User");
const Queue = require("../src/models/Queue");
require("dotenv").config();

const seedDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("✅ Connected to DB");

    // Clear DB
    await User.deleteMany({});
    await Queue.deleteMany({});

    // Create Admin
    const admin = await User.create({
      name: "Admin User",
      email: "admin@example.com",
      password: "password123",
      role: "admin",
    });

    // Create User
    const user = await User.create({
      name: "John Doe",
      email: "john@example.com",
      password: "password123",
      role: "user",
    });

    // Create Queue
    const queue = await Queue.create({
      name: "Dr. Smith Clinic",
      admin: admin._id,
    });

    // Generate Tokens
    const adminToken = jwt.sign(
      { id: admin._id, role: admin.role },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    const userToken = jwt.sign(
      { id: user._id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    console.log("\n--- SEED DATA ---");
    console.log("Queue ID:", queue._id.toString());
    console.log("\nAdmin Token:", adminToken);
    console.log("\nUser Token:", userToken);
    console.log("\n-----------------");

    process.exit();
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
};

seedDB();
