const express = require("express");
const router = express.Router();
const User = require("../models/User");
const jwt = require("jsonwebtoken");
const { protect } = require("../middleware/auth");

/**
 * Rejects the request with 400 unless every listed field that is present is a
 * string. Stops NoSQL operator injection such as {"email": {"$gt": ""}}, which
 * would otherwise be passed into User.findOne as a query operator.
 * Presence is still checked by each route. Full validation is plan item B1.
 */
const requireStringFields = (...fields) => (req, res, next) => {
  const body = req.body || {};
  const invalid = fields.filter((f) => body[f] !== undefined && typeof body[f] !== "string");
  if (invalid.length > 0) {
    return res.status(400).json({
      message: `${invalid.join(", ")} must be a string`,
      code: "VALIDATION_ERROR",
      errors: invalid.map((field) => ({ field, message: "must be a string" })),
    });
  }
  return next();
};

// Register route. Always creates a regular user; admins are created only via
// scripts/create_admin.js (or the seed script), never from a public endpoint.
// Nothing here logs the request body, headers, password or token.
router.post("/register", requireStringFields("name", "email", "password"), async (req, res, next) => {
  try {
    // `role` from the body is deliberately ignored: self-registration as admin
    // was possible before.
    const { name, email, password } = req.body;
    const role = "user";

    if (!name || !email || !password) {
      return res.status(400).json({
        message: "Missing required fields",
        details: { name: !!name, email: !!email, password: !!password, receivedRole: role },
      });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: "User with this email already exists", email });
    }

    const user = new User({ name, email, password, role });
    const validationError = user.validateSync();
    if (validationError) {
      return res.status(400).json({
        message: "Validation failed",
        errors: Object.keys(validationError.errors).map((key) => ({
          field: key,
          message: validationError.errors[key].message,
        })),
      });
    }

    await user.save();

    const token = jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET, { expiresIn: "7d" });

    res.status(201).json({
      message: `${user.role} registered successfully`,
      token,
      user: { id: user._id, name: user.name, email: user.email, role: user.role },
    });
  } catch (error) {
    // Two registrations racing past the findOne above.
    if (error.name === "MongoServerError" && error.code === 11000) {
      return res.status(400).json({ message: "Email already exists", error: "DUPLICATE_EMAIL" });
    }
    if (error.name === "ValidationError") {
      return res.status(400).json({
        message: "Validation failed",
        errors: Object.keys(error.errors).map((key) => ({ field: key, message: error.errors[key].message })),
      });
    }
    return next(error);
  }
});

// Login route
router.post("/login", requireStringFields("email", "password"), async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        message: "Please provide email and password",
        received: { email: !!email, password: !!password },
      });
    }

    // NOTE: these two messages reveal whether the email exists; plan item B2.
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ message: "Invalid credentials - user not found", email });
    }

    const isMatch = await user.matchPassword(password);
    if (!isMatch) {
      return res.status(400).json({ message: "Invalid credentials - wrong password" });
    }

    const token = jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET, { expiresIn: "7d" });

    res.status(200).json({
      message: "Login successful",
      token,
      user: { id: user._id, name: user.name, email: user.email, role: user.role },
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/me", protect, (req, res) => {
  res.json({ user: req.user });
});

module.exports = router;
