const mongoose = require("mongoose");

/**
 * One user's place in one queue. Tickets are the source of truth for the
 * waiting list (status "waiting", ordered by seq) and the person being served
 * (status "serving"). Correctness under concurrency comes from the unique
 * indexes below, not from read-then-write checks in the routes.
 */
const TICKET_STATUSES = ["waiting", "serving", "served", "cancelled"];
const ACTIVE_STATUSES = ["waiting", "serving"];

const ticketSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    queue: { type: mongoose.Schema.Types.ObjectId, ref: "Queue", required: true },
    queueName: { type: String, required: true },

    // Position in the queue's numbering; token is derived from it on join.
    seq: { type: Number },
    token: { type: String, required: true },

    status: { type: String, enum: TICKET_STATUSES, default: "waiting" },
    // true while waiting or serving. Kept as its own field because a partial
    // index needs a plain equality filter to work on every MongoDB version.
    active: { type: Boolean, default: true },

    joinedAt: { type: Date, default: Date.now },
    startedAt: { type: Date },
    completedAt: { type: Date },
  },
  { timestamps: true }
);

// No two tickets in a queue share a number, so tokens can't repeat.
ticketSchema.index(
  { queue: 1, seq: 1 },
  { unique: true, partialFilterExpression: { seq: { $type: "number" } } }
);
// A user holds at most one active ticket per queue: rapid double taps on
// Join can't create two.
ticketSchema.index({ queue: 1, user: 1 }, { unique: true, partialFilterExpression: { active: true } });
// At most one person is being served per queue: two concurrent call-nexts
// can't both pull someone to the counter.
ticketSchema.index({ queue: 1 }, { unique: true, partialFilterExpression: { status: "serving" } });
// Waiting list reads (ordered by seq) and per-user lookups.
ticketSchema.index({ queue: 1, status: 1, seq: 1 });
ticketSchema.index({ user: 1, status: 1 });

/** Fields to $set when moving a ticket to `status`, keeping `active` in sync. */
ticketSchema.statics.transition = (status, extra = {}) => ({
  status,
  active: ACTIVE_STATUSES.includes(status),
  ...extra,
});

module.exports = mongoose.model("Ticket", ticketSchema);
module.exports.TICKET_STATUSES = TICKET_STATUSES;
module.exports.ACTIVE_STATUSES = ACTIVE_STATUSES;
