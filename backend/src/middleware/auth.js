const jwt = require("jsonwebtoken");
const User = require("../models/User");

const unauthorized = (res, message) =>
  res.status(401).json({ message, code: "UNAUTHORIZED" });

/**
 * Requires `Authorization: Bearer <jwt>` and loads the user onto req.user.
 * Every path sends exactly one response or calls next() exactly once.
 */
const protect = async (req, res, next) => {
  const header = req.headers.authorization || "";
  const [scheme, token] = header.split(" ");

  if (scheme !== "Bearer" || !token) {
    return unauthorized(res, "Not authorized, no token");
  }

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return unauthorized(res, "Not authorized");
  }

  try {
    const user = await User.findById(decoded.id).select("-password");
    if (!user) {
      // Token is valid but the account no longer exists.
      return unauthorized(res, "Not authorized");
    }
    req.user = user;
  } catch (err) {
    // A DB failure is a server error, not an auth failure.
    return next(err);
  }

  return next();
};

module.exports = { protect };
