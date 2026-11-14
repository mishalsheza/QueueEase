const MESSAGES = {
  admin: "Admin access only",
  user: "Admins manage queues and cannot join or leave them",
};

/**
 * Allows the request only if req.user.role matches. Use after `protect`.
 * The backend is the source of truth for roles; the app's route guards only
 * hide screens.
 */
const requireRole = (role) => {
  if (!MESSAGES[role]) throw new Error(`Unknown role: ${role}`);

  return (req, res, next) => {
    if (!req.user || req.user.role !== role) {
      return res.status(403).json({ message: MESSAGES[role], code: "FORBIDDEN" });
    }
    return next();
  };
};

module.exports = { requireRole };
