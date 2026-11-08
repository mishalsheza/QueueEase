const express = require("express");
const router = express.Router();
const Queue = require("../models/Queue");
const Ticket = require("../models/Ticket");
const { protect } = require("../middleware/auth");

/**
 * Admin creates a queue
 */
router.post("/", protect, async (req, res) => {
  if (req.user.role !== "admin") {
    return res.status(403).json({ message: "Admin access only" });
  }

  const queue = await Queue.create({
    name: req.body.name,
    admin: req.user._id,
    type: req.body.type || 'General Checkup',
    section: req.body.section || 'A'
  });

  res.status(201).json(queue);
});

/**
 * Get all queues
 */
router.get("/", protect, async (req, res) => {
  const queues = await Queue.find().populate("admin", "name email");
  res.json(queues);
});

/**
 * Get current user's active queues
 */
router.get("/my-status", protect, async (req, res) => {
  try {
    // 1. Find queues where user is waiting OR being served
    const activeQueues = await Queue.find({
      $or: [
        { "users.user": req.user._id },
        { "nowServing.user": req.user._id }
      ]
    });

    const activeStatus = activeQueues.map((queue) => {
      const isServing = queue.nowServing && queue.nowServing.user && queue.nowServing.user.toString() === req.user._id.toString();
      
      let index = -1;
      if (!isServing) {
        index = queue.users.findIndex(
          (u) => u.user && u.user.toString() === req.user._id.toString()
        );
      }
      
      const tokenPrefix = (queue.name && queue.name.length > 0) ? queue.name.charAt(0).toUpperCase() : 'Q';
      const token = isServing ? queue.nowServing.token : `${tokenPrefix}-${index + 1}`;

      return {
        queueId: queue._id,
        queueName: queue.name,
        position: isServing ? 0 : index + 1,
        status: isServing ? 'serving' : 'waiting',
        totalInQueue: queue.users.length,
        token: token,
        estimatedWaitTime: isServing ? 0 : index * 5,
        counter: "01",
        currentlyServing: queue.nowServing ? queue.nowServing.token : "None"
      };
    });

    // 2. Find recently completed tickets (last 10 minutes) to show "Completed" status
    const recentTickets = await Ticket.find({
      user: req.user._id,
      status: { $in: ["served", "cancelled"] },
      completedAt: { $gte: new Date(Date.now() - 10 * 60 * 1000) }
    }).sort({ completedAt: -1 });

    const historyStatus = recentTickets.map(ticket => ({
      queueId: ticket.queue,
      queueName: ticket.queueName,
      position: -1,
      status: ticket.status,
      totalInQueue: 0,
      token: ticket.token,
      estimatedWaitTime: 0,
      counter: "Completed",
      currentlyServing: ticket.token
    }));

    res.json([...activeStatus, ...historyStatus]);
  } catch (error) {
    console.error("❌ My-Status Error:", error);
    res.status(500).json({ message: error.message });
  }
});

/**
 * Get current user's historical tickets (Served/Cancelled)
 */
router.get("/my-history", protect, async (req, res) => {
  try {
    const tickets = await Ticket.find({
      user: req.user._id,
      status: { $in: ["served", "cancelled"] }
    }).sort({ createdAt: -1 });
    res.json(tickets);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

/**
 * User joins a queue
 */
router.post("/:queueId/join", protect, async (req, res) => {
  try {
    console.log(`👤 User ${req.user._id} attempting to join queue ${req.params.queueId}`);
    
    const queue = await Queue.findById(req.params.queueId);
    if (!queue) {
      console.log(`❌ Queue ${req.params.queueId} not found`);
      return res.status(404).json({ message: "Queue not found" });
    }

    const alreadyJoined = queue.users.find(
      (u) => u.user && u.user.toString() === req.user._id.toString()
    );

    if (alreadyJoined) {
      console.log(`ℹ️ User ${req.user._id} is already in queue ${queue.name}. Returning success.`);
      return res.json(queue);
    }

    queue.users.push({ user: req.user._id });
    await queue.save();

    console.log(`✅ User ${req.user._id} successfully joined queue ${queue.name}`);

    // Create a new Ticket record for history
    const tokenPrefix = (queue.name && queue.name.length > 0)
      ? queue.name.charAt(0).toUpperCase()
      : 'Q';
    const token = `${tokenPrefix}-${queue.users.length}`;

    await Ticket.create({
      user: req.user._id,
      queue: queue._id,
      queueName: queue.name,
      token: token,
      status: "waiting"
    });

    // 🔴 Emit live update
    const io = req.app.get("io");
    if (io) {
      io.to(req.params.queueId).emit("queueUpdated", queue);
    }

    res.json(queue);
  } catch (error) {
    console.error("❌ Join Queue Error:", error);
    res.status(500).json({ message: "Server error joining queue", error: error.message });
  }
});

/**
 * User leaves a queue
 */
router.post("/:queueId/leave", protect, async (req, res) => {
  const queue = await Queue.findById(req.params.queueId);
  if (!queue) return res.status(404).json({ message: "Queue not found" });

  queue.users = queue.users.filter(
    (u) => u.user.toString() !== req.user._id.toString()
  );

  await queue.save();

  // Mark the active ticket as cancelled
  await Ticket.findOneAndUpdate(
    { user: req.user._id, queue: queue._id, status: "waiting" },
    { status: "cancelled", completedAt: new Date() },
    { sort: { createdAt: -1 } }
  );

  // 🔴 Emit live update
  const io = req.app.get("io");
  if (io) {
    io.to(req.params.queueId).emit("queueUpdated", queue);
  }

  res.json(queue);
});

/**
 * Get current user's position in a queue
 */
router.get("/:queueId/position", protect, async (req, res) => {
  const queue = await Queue.findById(req.params.queueId);
  if (!queue) {
    return res.status(404).json({ message: "Queue not found" });
  }

  const index = queue.users.findIndex(
    (u) => u.user.toString() === req.user._id.toString()
  );

  if (index === -1) {
    return res.status(400).json({ message: "User not in queue" });
  }

  res.json({
    queueName: queue.name,
    position: index + 1,           // index starts from 0
    totalUsers: queue.users.length,
  });
});


/**
 * Admin calls next user
 */
router.post("/:queueId/call-next", protect, async (req, res) => {
  if (req.user.role !== "admin") {
    return res.status(403).json({ message: "Admin access only" });
  }

  const queue = await Queue.findById(req.params.queueId);
  if (!queue) return res.status(404).json({ message: "Queue not found" });

  if (queue.users.length > 0) {
    // 1. If someone is already being served, mark them as served automatically
    if (queue.nowServing && queue.nowServing.user) {
      await Ticket.findOneAndUpdate(
        { user: queue.nowServing.user, queue: queue._id, status: "serving" },
        { status: "served", completedAt: new Date() },
        { sort: { createdAt: -1 } }
      );
      queue.servedToday = (queue.servedToday || 0) + 1;
    }

    const nextUserEntry = queue.users[0];
    const ticket = await Ticket.findOne({ 
      user: nextUserEntry.user, 
      queue: queue._id, 
      status: "waiting" 
    }).sort({ createdAt: 1 });

    const tokenPrefix = (queue.name && queue.name.length > 0) ? queue.name.charAt(0).toUpperCase() : 'Q';
    const currentToken = ticket ? ticket.token : `${tokenPrefix}-${queue.servedToday + 1}`;

    queue.nowServing = {
      user: nextUserEntry.user,
      token: currentToken,
      startedAt: new Date()
    };

    // Remove the first user
    queue.users.shift();
    await queue.save();

    // Mark the ticket as serving
    if (ticket) {
      ticket.status = "serving";
      await ticket.save();
    }

    // 🔴 Emit live update
    const io = req.app.get("io");
    if (io) {
      io.emit("queueUpdated", queue);
    }
    
    res.json({ message: "Next user called", queue });
  } else {
    res.status(400).json({ message: "Queue is empty" });
  }
});

/**
 * Admin marks current user as served (Completed)
 */
router.post("/:queueId/serve", protect, async (req, res) => {
  if (req.user.role !== "admin") {
    return res.status(403).json({ message: "Admin access only" });
  }

  const queue = await Queue.findById(req.params.queueId);
  if (!queue) return res.status(404).json({ message: "Queue not found" });

  if (queue.nowServing && queue.nowServing.user) {
    const servedUserId = queue.nowServing.user;

    // Mark the ticket as served
    await Ticket.findOneAndUpdate(
      { user: servedUserId, queue: queue._id, status: "serving" },
      { status: "served", completedAt: new Date() },
      { sort: { createdAt: -1 } }
    );

    // Update queue stats
    queue.nowServing = undefined;
    queue.servedToday = (queue.servedToday || 0) + 1;
    await queue.save();

    // 🔴 Emit live update
    const io = req.app.get("io");
    if (io) {
      io.emit("queueUpdated", queue);
    }
    
    res.json({ message: "User served", queue });
  } else {
    res.status(400).json({ message: "No user is currently being served" });
  }
});

// Admin: Get ALL users report (Waiting, Serving, Served, Cancelled)
router.get("/admin/users-report", protect, async (req, res) => {
  if (req.user.role !== "admin") {
    return res.status(403).json({ message: "Admin access only" });
  }

  try {
    // Fetch all tickets to show history + active
    const tickets = await Ticket.find()
      .populate("user", "name email")
      .populate("queue", "users")
      .sort({ createdAt: -1 });

    const report = tickets.map(ticket => {
      // Calculate real-time position for waiting tickets
      let position = -1;
      let waitTime = 0;

      if (ticket.status === 'waiting' && ticket.queue) {
        const qUsers = ticket.queue.users || [];
        const index = qUsers.findIndex(u => u.user.toString() === ticket.user._id.toString());
        if (index !== -1) {
          position = index + 1;
          waitTime = index * 5; // Approx 5 min per person
        }
      }

      return {
        id: ticket._id,
        name: ticket.user ? ticket.user.name : 'Unknown',
        token: ticket.token,
        queueName: ticket.queueName,
        joinedAt: ticket.createdAt,
        status: ticket.status,
        position: position,
        waitTime: waitTime,
        queueId: ticket.queue ? ticket.queue._id : null,
        userId: ticket.user ? ticket.user._id : null
      };
    });

    res.json(report);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

/**
 * Admin: Get recently completed tickets
 */
router.get("/admin/completed-report", protect, async (req, res) => {
  if (req.user.role !== "admin") {
    return res.status(403).json({ message: "Admin access only" });
  }

  try {
    const tickets = await Ticket.find({ status: "served" })
      .populate("user", "name email")
      .sort({ completedAt: -1 })
      .limit(20);
    
    res.json(tickets);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

/**
 * Admin deletes a queue
 */
router.delete("/:queueId", protect, async (req, res) => {
  if (req.user.role !== "admin") {
    return res.status(403).json({ message: "Admin access only" });
  }

  try {
    const queue = await Queue.findByIdAndDelete(req.params.queueId);
    if (!queue) {
      return res.status(404).json({ message: "Queue not found" });
    }

    // Also delete associated tickets if needed, or keep for history.
    // For now, we'll keep history or maybe mark them orphan. 
    // Let's just delete active tickets for this queue to avoid confusion? 
    // Actually, let's keep it simple: Just delete the queue.

    // 🔴 Emit live update
    const io = req.app.get("io");
    if (io) {
      io.emit("queueUpdated", { type: 'delete', queueId: req.params.queueId });
    }

    res.json({ message: "Queue removed" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
