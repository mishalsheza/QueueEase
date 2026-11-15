const mongoose = require("mongoose");

/**
 * A queue (a service counter). Who is waiting and who is being served is not
 * stored here: Tickets are the single source of truth (see Ticket.js). This
 * document only holds settings, the lifecycle status and the token counter.
 */
const QUEUE_STATUSES = ["open", "paused", "closed"];

const queueSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    admin: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    type: { type: String, default: "General Checkup" },
    section: { type: String, default: "A" },

    // open:   accepts joins
    // paused: rejects new joins, keeps the waiting list; the admin can still
    //         call and serve the people already waiting
    // closed: final. Rejects joins, waiting tickets were cancelled, history
    //         stays in reports. Replaces the old hard delete.
    status: { type: String, enum: QUEUE_STATUSES, default: "open" },
    closedAt: { type: Date },

    // Last ticket number handed out. Incremented atomically on join, so every
    // ticket in a queue gets a unique token (A-1, A-2, ...).
    lastSeq: { type: Number, default: 0 },

    // Minutes after being called before the person shows as overdue on the
    // admin dashboard. Only a hint: marking a no-show stays manual.
    graceMinutes: {
      type: Number,
      default: 5,
      min: 1,
      max: 120,
      validate: { validator: Number.isInteger, message: "graceMinutes must be a whole number" },
    },

    servedToday: { type: Number, default: 0 },
    avgProcessTime: { type: Number, default: 15 },
  },
  { timestamps: true }
);

// B3: an admin's queues (dashboard list, reports) and the open queues users
// can join. Closed queues are kept for history, so this collection only grows.
queueSchema.index({ admin: 1, status: 1 });
queueSchema.index({ status: 1 });

module.exports = mongoose.model("Queue", queueSchema);
module.exports.QUEUE_STATUSES = QUEUE_STATUSES;
