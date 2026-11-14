const express = require("express");
const router = express.Router();
const Queue = require("../models/Queue");
const Ticket = require("../models/Ticket");
const { protect } = require("../middleware/auth");
const asyncHandler = require("../utils/asyncHandler");
const { requireRole } = require("../middleware/requireRole");
const { requireQueueOwner } = require("../middleware/requireQueueOwner");
const svc = require("../services/queueService");

// Queue logic lives in services/queueService.js; routes handle HTTP only.

// Reject malformed ids up front with the same 400 as before, whichever query
// would have hit them first.
router.param("queueId", (req, res, next, id) => {
  if (/^[0-9a-fA-F]{24}$/.test(id)) return next();
  return res.status(400).json({ message: "Invalid _id", code: "INVALID_ID" });
});

/** Tells clients watching this queue (and, for now, everyone) to refresh. */
const notify = (req, payload, room) => {
  const io = req.app.get("io");
  if (!io) return;
  // NOTE: global broadcast and unauthenticated sockets are plan item A5.
  if (room) io.to(room).emit("queueUpdated", payload);
  else io.emit("queueUpdated", payload);
};

/** Admin creates a queue. */
router.post("/", protect, requireRole("admin"), asyncHandler(async (req, res) => {
  const queue = await Queue.create({
    name: req.body.name,
    admin: req.user._id,
    type: req.body.type || "General Checkup",
    section: req.body.section || "A",
    ...(req.body.graceMinutes !== undefined && { graceMinutes: req.body.graceMinutes }),
  });
  res.status(201).json(await svc.withLiveState(queue));
}));

/**
 * List queues that aren't closed. Users see every one (so they can join any);
 * admins see only the queues they own.
 */
router.get("/", protect, asyncHandler(async (req, res) => {
  res.json(await svc.listQueues(req.user));
}));

/** Signed-in user's active tickets plus ones completed in the last 10 minutes. */
router.get("/my-status", protect, asyncHandler(async (req, res) => {
  res.json(await svc.userStatus(req.user));
}));

/** Signed-in user's served/cancelled tickets. */
router.get("/my-history", protect, asyncHandler(async (req, res) => {
  const tickets = await Ticket.find({ user: req.user._id, status: { $in: ["served", "cancelled", "no_show"] } })
    .sort({ createdAt: -1 });
  res.json(tickets);
}));

/** User joins a queue (409 if it is paused or closed). */
router.post("/:queueId/join", protect, requireRole("user"), asyncHandler(async (req, res) => {
  const { queue, created } = await svc.joinQueue(req.params.queueId, req.user);
  if (created) notify(req, queue, req.params.queueId);
  res.json(queue);
}));

/** User leaves a queue. */
router.post("/:queueId/leave", protect, requireRole("user"), asyncHandler(async (req, res) => {
  const queue = await svc.leaveQueue(req.params.queueId, req.user);
  notify(req, queue, req.params.queueId);
  res.json(queue);
}));

/** Signed-in user's position in a queue. */
router.get("/:queueId/position", protect, asyncHandler(async (req, res) => {
  res.json(await svc.userPosition(req.params.queueId, req.user));
}));

/** Admin calls the next person. */
router.post("/:queueId/call-next", protect, requireRole("admin"), requireQueueOwner, asyncHandler(async (req, res) => {
  const queue = await svc.callNext(req.queue);
  notify(req, queue);
  res.json({ message: "Next user called", queue });
}));

/**
 * Admin marks the person at the counter as served. Optional body
 * { ticketId }: 409 if that ticket is no longer at the counter.
 */
router.post("/:queueId/serve", protect, requireRole("admin"), requireQueueOwner, asyncHandler(async (req, res) => {
  const queue = await svc.serveCurrent(req.queue, req.body && req.body.ticketId);
  notify(req, queue);
  res.json({ message: "User served", queue });
}));

/**
 * Admin marks the person at the counter as a no-show. Optional body
 * { ticketId }. Atomic with serve: if both happen at once, one gets 409.
 */
router.post("/:queueId/no-show", protect, requireRole("admin"), requireQueueOwner, asyncHandler(async (req, res) => {
  const { ticket, queue } = await svc.markNoShow(req.queue, req.body && req.body.ticketId);
  notify(req, queue);
  res.json({ message: "Marked as no-show", token: ticket.token, queue });
}));

/** Admin changes queue settings: body { graceMinutes } (1-120). */
router.patch("/:queueId/settings", protect, requireRole("admin"), requireQueueOwner, asyncHandler(async (req, res) => {
  res.json({ message: "Settings saved", queue: await svc.updateSettings(req.queue, req.body) });
}));

/** Admin pauses or resumes a queue: body { status: "paused" | "open" }. */
router.patch("/:queueId/status", protect, requireRole("admin"), requireQueueOwner, asyncHandler(async (req, res) => {
  const queue = await svc.setQueueStatus(req.queue, req.body && req.body.status);
  notify(req, queue);
  res.json({ message: queue.status === "paused" ? "Queue paused" : "Queue resumed", queue });
}));

/**
 * Admin closes a queue. Replaces the old hard delete: new joins are rejected,
 * waiting tickets are cancelled, and history stays in reports.
 * DELETE /:queueId is kept as an alias so existing clients keep working.
 */
const closeHandler = asyncHandler(async (req, res) => {
  const result = await svc.closeQueue(req.queue);
  notify(req, { type: "closed", queueId: req.params.queueId });
  res.json({ message: "Queue closed", ...result });
});
router.post("/:queueId/close", protect, requireRole("admin"), requireQueueOwner, closeHandler);
router.delete("/:queueId", protect, requireRole("admin"), requireQueueOwner, closeHandler);

/** Admin: every ticket in the admin's own queues, including closed ones. */
router.get("/admin/users-report", protect, requireRole("admin"), asyncHandler(async (req, res) => {
  res.json(await svc.usersReport(req.user));
}));

/** Admin: ticket counts by status (no-shows separate), overall and per queue. */
router.get("/admin/stats", protect, requireRole("admin"), asyncHandler(async (req, res) => {
  res.json(await svc.statsReport(req.user));
}));

/** Admin: recently served tickets from the admin's own queues. */
router.get("/admin/completed-report", protect, requireRole("admin"), asyncHandler(async (req, res) => {
  res.json(await svc.completedReport(req.user));
}));

module.exports = router;
