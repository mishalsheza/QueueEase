const express = require("express");
const router = express.Router();
const User = require("../models/User");
const jwt = require("jsonwebtoken"); 
const { protect } = require("../middleware/auth"); // ADD THIS LINE

// Register route
// backend/routes/auth.js - UPDATED VERSION
router.post("/register", async (req, res, next) => {
  console.log("🔐 REGISTER REQUEST RECEIVED");
  console.log("Headers:", req.headers);
  console.log("Full body:", JSON.stringify(req.body, null, 2));

  try {
    const { name, email, password, role = "user" } = req.body; // Default to "user"

    console.log("📋 Parsed fields:", { name, email, password, role });

    // Basic validation
    if (!name || !email || !password) {
      console.log("❌ Missing required fields");
      return res.status(400).json({ 
        message: "Missing required fields",
        details: { 
          name: !!name, 
          email: !!email, 
          password: !!password,
          receivedRole: role 
        }
      });
    }

    console.log("🔍 Checking for existing user...");
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      console.log("❌ User already exists:", email);
      return res.status(400).json({ 
        message: "User with this email already exists",
        email: email 
      });
    }

    console.log("👤 Creating new user...");
    
    // Create user object without saving yet
    const userData = {
      name,
      email,
      password,
      role: role || "user" // Ensure role is set
    };
    
    console.log("📝 User data to save:", userData);
    
    // Try to create with validation
    const user = new User(userData);
    
    // Validate before save
    const validationError = user.validateSync();
    if (validationError) {
      console.log("❌ Validation error:", validationError.errors);
      return res.status(400).json({
        message: "Validation failed",
        errors: Object.keys(validationError.errors).map(key => ({
          field: key,
          message: validationError.errors[key].message
        }))
      });
    }
    
    // Save the user
    await user.save();
    
    console.log("✅ User created successfully:", user._id);
    console.log("📊 User details:", {
      id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      passwordLength: user.password ? user.password.length : 0
    });

    // Generate token
    const token = jwt.sign(
      { id: user._id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );
    console.log("✅ Token generated:", token.substring(0, 20) + "...");


    res.status(201).json({
      message: `${user.role} registered successfully`,
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });

  } catch (error) {
    console.error("🔥 REGISTER ERROR DETAILS:");
    console.error("Error name:", error.name);
    console.error("Error message:", error.message);
    console.error("Error code:", error.code);
    console.error("Error stack:", error.stack);
    
    if (error.name === 'MongoServerError' && error.code === 11000) {
      return res.status(400).json({ 
        message: "Email already exists",
        error: "DUPLICATE_EMAIL" 
      });
    }
    
    if (error.name === 'ValidationError') {
      return res.status(400).json({ 
        message: "Validation failed",
        errors: Object.keys(error.errors).map(key => ({
          field: key,
          message: error.errors[key].message
        }))
      });
    }
    
    return next(error);
  }
});

// Login route
// In backend/routes/auth.js - REPLACE the login route with this:
router.post("/login", async (req, res, next) => {
  console.log("🔐 LOGIN REQUEST RECEIVED");
  console.log("Headers:", req.headers);
  console.log("Login body:", req.body);
  
  try {
    const { email, password } = req.body;

    console.log("📋 Login attempt for email:", email);

    if (!email || !password) {
      console.log("❌ Missing email or password");
      return res.status(400).json({ 
        message: "Please provide email and password",
        received: { email: !!email, password: !!password }
      });
    }

    console.log("🔍 Looking for user with email:", email);
    const user = await User.findOne({ email });
    
    if (!user) {
      console.log("❌ No user found with email:", email);
      return res.status(400).json({ 
        message: "Invalid credentials - user not found",
        email: email 
      });
    }

    console.log("✅ User found:", user._id);
    console.log("📊 User details:", {
      id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      passwordHash: user.password ? `Hash length: ${user.password.length}` : "No password"
    });

    console.log("🔑 Checking password...");
    
    // Debug: Check what password we're comparing
    console.log("Input password:", password);
    console.log("Stored password hash:", user.password ? user.password.substring(0, 20) + "..." : "No password");
    
    const isMatch = await user.matchPassword(password);
    console.log("Password match result:", isMatch);
    
    if (!isMatch) {
      console.log("❌ Password doesn't match");
      return res.status(400).json({ 
        message: "Invalid credentials - wrong password" 
      });
    }

    console.log("✅ Password verified successfully");
    
    // Check JWT_SECRET
    if (!process.env.JWT_SECRET) {
      console.error("❌ JWT_SECRET is not set in environment variables");
      return res.status(500).json({ message: "Server configuration error" });
    }
    
    console.log("✅ JWT_SECRET is set, generating token...");
    
    const token = jwt.sign(
      { id: user._id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    console.log("✅ Token generated, length:", token.length);
    console.log("👤 User data to return:", {
      id: user._id,
      name: user.name,
      email: user.email,
      role: user.role
    });

    res.status(200).json({
      message: "Login successful",
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });

  } catch (error) {
    console.error("🔥 LOGIN ERROR DETAILS:");
    console.error("Error:", error);
    console.error("Stack:", error.stack);
    return next(error);
  }
});
router.get("/me", protect, (req, res) => {
  res.json({
    user: req.user
  });
});

// Add this route to auth.js for testing
router.get("/test-protected", protect, (req, res) => {
  res.json({ 
    message: "Protected route works",
    user: req.user 
  });
});

// Add a simple test route without protection
router.get("/test", (req, res) => {
  res.json({ message: "Auth router is working!", time: new Date() });
});

module.exports = router;