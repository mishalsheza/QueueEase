const jwt = require("jsonwebtoken");
const User = require("../models/User");

const unauthorized = (res, message) =>
  res.status(401).json({ message, code: "UNAUTHORIZED" });

/**
 * Returns the user a JWT belongs to, or null if the token is invalid, expired
 * or the account no longer exists. Database errors are thrown (a server
 * problem, not an auth failure). Shared by REST (protect) and Socket.io.
 */
async function userFromToken(token) {
  if (typeof token !== "string" || !token) return null;
  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return null;
  }
  return User.findById(decoded.id).select("-password");
}

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

  let user;
  try {
    user = await userFromToken(token);
  } catch (err) {
    return next(err);
  }
  if (!user) return unauthorized(res, "Not authorized");

  req.user = user;
  return next();
};

module.exports = { protect, userFromToken };
