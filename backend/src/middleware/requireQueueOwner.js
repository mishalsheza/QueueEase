const Queue = require("../models/Queue");

/**
 * Loads :queueId and allows the request only if the signed-in admin owns it.
 * Use after `protect` and `requireRole("admin")`. Sets req.queue.
 *
 * Prevents one admin from calling next, serving or deleting on another
 * admin's queue (an IDOR: the queue id alone used to be enough).
 *
 *   404 if the queue doesn't exist, 403 if it belongs to another admin.
 *   An invalid id becomes a CastError, which errorHandler turns into 400.
 */
const requireQueueOwner = async (req, res, next) => {
  try {
    const queue = await Queue.findById(req.params.queueId);
    if (!queue) {
      return res.status(404).json({ message: "Queue not found", code: "NOT_FOUND" });
    }
    if (!queue.admin || !queue.admin.equals(req.user._id)) {
      return res.status(403).json({ message: "You can only manage your own queues", code: "FORBIDDEN" });
    }
    req.queue = queue;
    return next();
  } catch (err) {
    return next(err);
  }
};

module.exports = { requireQueueOwner };
