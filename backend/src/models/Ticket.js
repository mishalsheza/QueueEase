const mongoose = require("mongoose");

/**
 * One user's place in one queue. Tickets are the source of truth for the
 * waiting list (status "waiting", ordered by seq) and the person being served
 * (status "serving"). Correctness under concurrency comes from the unique
 * indexes below, not from read-then-write checks in the routes.
 */
// waiting -> called (call next) -> served   (serve)
//                               -> no_show  (admin marks they didn't come)
// waiting -> cancelled (leave, or the queue was closed)
// "serving" is the pre-no-show name for "at the counter". New code produces
// "called"; existing "serving" tickets are treated the same way.
const TICKET_STATUSES = ["waiting", "called", "serving", "served", "cancelled", "no_show"];
const AT_COUNTER_STATUSES = ["called", "serving"];
const ACTIVE_STATUSES = ["waiting", ...AT_COUNTER_STATUSES];

const ticketSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    queue: { type: mongoose.Schema.Types.ObjectId, ref: "Queue", required: true },
    queueName: { type: String, required: true },

    // Position in the queue's numbering; token is derived from it on join.
    seq: { type: Number },
    token: { type: String, required: true },

    status: { type: String, enum: TICKET_STATUSES, default: "waiting" },
    // Derived flags, kept as their own fields because a partial index needs a
    // plain equality filter to work on every MongoDB version. Always set via
    // Ticket.transition().
    active: { type: Boolean, default: true }, // waiting, called or serving
    atCounter: { type: Boolean, default: false }, // called or serving

    joinedAt: { type: Date, default: Date.now },
    calledAt: { type: Date }, // when call-next called this ticket
    startedAt: { type: Date }, // legacy: set on old "serving" tickets
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
// At most one person at the counter per queue: two concurrent call-nexts can't
// both call someone, and serve / no-show race on the same single document.
ticketSchema.index(
  { queue: 1 },
  { unique: true, name: "one_at_counter_per_queue", partialFilterExpression: { atCounter: true } }
);
// Waiting list reads (ordered by seq) and per-user lookups.
ticketSchema.index({ queue: 1, status: 1, seq: 1 });
ticketSchema.index({ user: 1, status: 1 });

/** Fields to $set when moving a ticket to `status`, keeping the flags in sync. */
ticketSchema.statics.transition = (status, extra = {}) => ({
  status,
  active: ACTIVE_STATUSES.includes(status),
  atCounter: AT_COUNTER_STATUSES.includes(status),
  ...extra,
});

module.exports = mongoose.model("Ticket", ticketSchema);
module.exports.TICKET_STATUSES = TICKET_STATUSES;
module.exports.ACTIVE_STATUSES = ACTIVE_STATUSES;
module.exports.AT_COUNTER_STATUSES = AT_COUNTER_STATUSES;
