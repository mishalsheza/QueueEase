const express = require("express");
const router = express.Router();
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const { protect } = require("../middleware/auth");
const { validate } = require("../middleware/validate");
const { schemas } = require("../validation/schemas");
const asyncHandler = require("../utils/asyncHandler");

const signToken = (user) => jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET, { expiresIn: "7d" });
const publicUser = (user) => ({ id: user._id, name: user.name, email: user.email, role: user.role });

// Compared against when the email doesn't exist, so a failed login takes the
// same time (one bcrypt compare at the same cost) whether or not the account
// exists. Without it, response time alone would reveal registered emails.
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", 10);

const INVALID_CREDENTIALS = { message: "Invalid email or password", code: "INVALID_CREDENTIALS" };

/**
 * Register. Always creates a regular user: `role` (and any other unknown
 * field) is dropped by validation. Admins are created only via
 * scripts/create_admin.js or the seed script.
 *
 * Note: "already exists" does reveal that an email is registered. That is
 * inherent to an instant signup; hiding it needs an email-verification flow.
 */
router.post("/register", validate(schemas.register), asyncHandler(async (req, res) => {
  const { name, email, password } = req.body;

  if (await User.exists({ email })) {
    return res.status(400).json({ message: "User with this email already exists", code: "DUPLICATE_EMAIL" });
  }

  let user;
  try {
    user = await User.create({ name, email, password, role: "user" });
  } catch (err) {
    // Two registrations racing past the check above.
    if (err && err.code === 11000) {
      return res.status(400).json({ message: "User with this email already exists", code: "DUPLICATE_EMAIL" });
    }
    throw err; // Mongoose ValidationError -> 400 via errorHandler
  }

  res.status(201).json({ message: "user registered successfully", token: signToken(user), user: publicUser(user) });
}));

/**
 * Login. Unknown email and wrong password get the same 401 and message, and
 * take the same time, so the endpoint can't be used to find out which emails
 * have accounts.
 */
router.post("/login", validate(schemas.login), asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  const user = await User.findOne({ email });
  const passwordOk = user
    ? await user.matchPassword(password)
    : (await bcrypt.compare(password, DUMMY_HASH)) && false;

  if (!user || !passwordOk) return res.status(401).json(INVALID_CREDENTIALS);

  res.status(200).json({ message: "Login successful", token: signToken(user), user: publicUser(user) });
}));

router.get("/me", protect, (req, res) => {
  res.json({ user: req.user });
});

module.exports = router;
