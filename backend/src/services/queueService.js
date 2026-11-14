/**
 * Queue operations on the Ticket-first model.
 *
 * Tickets are the only record of who is waiting and who is being served, so
 * there is no second copy (the old Queue.users array) to fall out of sync.
 * Every state change is a single atomic update, or an insert guarded by a
 * unique index (see Ticket.js), instead of load-modify-save on one big
 * document. That is what removes the duplicate tokens, double joins and
 * VersionError conflicts measured in docs/architecture.md.
 */
const Queue = require("../models/Queue");
const Ticket = require("../models/Ticket");
const HttpError = require("../utils/httpError");

const AFTER = { returnDocument: "after" };
const isDuplicateKey = (err, field) => err && err.code === 11000 && (!field || (err.keyPattern && field in err.keyPattern));
const tokenPrefix = (name) => (name && name.length > 0 ? name.charAt(0).toUpperCase() : "Q");

const NOT_FOUND = () => new HttpError(404, "Queue not found", "NOT_FOUND");
const notAccepting = (status) =>
  status === "paused"
    ? new HttpError(409, "This queue is paused and isn't accepting new people right now", "QUEUE_PAUSED")
    : new HttpError(409, "This queue is closed", "QUEUE_CLOSED");

// ---------------------------------------------------------------------------
// Reading: live queue state is derived from tickets
// ---------------------------------------------------------------------------

/**
 * Adds the live state to queue documents, in the response shape the app
 * already uses:
 *   users:      [{ user, joinedAt, token }] waiting, in order
 *   nowServing: { user, token, startedAt } or undefined
 *   waitingCount, nextToken
 * One query for all queues, so a list doesn't cost a query per queue.
 */
async function withLiveState(queues) {
  const list = Array.isArray(queues) ? queues : [queues];
  const ids = list.map((q) => q._id);
  const active = await Ticket.find({ queue: { $in: ids }, active: true })
    .sort({ seq: 1, createdAt: 1 })
    .select("queue user token status joinedAt startedAt")
    .lean();

  const byQueue = new Map(ids.map((id) => [String(id), { waiting: [], serving: null }]));
  for (const t of active) {
    const entry = byQueue.get(String(t.queue));
    if (t.status === "serving") entry.serving = t;
    else entry.waiting.push(t);
  }

  const out = list.map((q) => {
    const { waiting, serving } = byQueue.get(String(q._id));
    const doc = typeof q.toObject === "function" ? q.toObject() : { ...q };
    return {
      ...doc,
      users: waiting.map((t) => ({ user: t.user, joinedAt: t.joinedAt, token: t.token })),
      nowServing: serving ? { user: serving.user, token: serving.token, startedAt: serving.startedAt } : undefined,
      waitingCount: waiting.length,
      nextToken: waiting.length > 0 ? waiting[0].token : null,
    };
  });
  return Array.isArray(queues) ? out : out[0];
}

/** Queues to list: users see every queue that isn't closed; admins see their own. */
async function listQueues(user) {
  const filter = { status: { $ne: "closed" } };
  if (user.role === "admin") filter.admin = user._id;
  const queues = await Queue.find(filter).populate("admin", "name email");
  return withLiveState(queues);
}

async function loadLive(queueId) {
  const queue = await Queue.findById(queueId);
  if (!queue) throw NOT_FOUND();
  return withLiveState(queue);
}

/** 1-based place of a waiting ticket: tickets with a smaller number go first. */
async function positionOf(ticket) {
  const ahead = await Ticket.countDocuments({ queue: ticket.queue, status: "waiting", seq: { $lt: ticket.seq } });
  return ahead + 1;
}

// ---------------------------------------------------------------------------
// User actions
// ---------------------------------------------------------------------------

/**
 * Joins a queue. Idempotent: joining again while holding an active ticket
 * returns 200 with the queue, as before.
 *
 * 1. Reserve the next number with one atomic $inc that only matches an open
 *    queue, so a paused or closed queue can't hand out a ticket.
 * 2. Insert the ticket. The unique (queue, user, active) index rejects a
 *    second concurrent join by the same user; that request returns the
 *    existing ticket instead of creating another.
 * 3. If the queue was closed between 1 and 2, cancel the new ticket.
 */
async function joinQueue(queueId, user) {
  const existing = await Ticket.findOne({ queue: queueId, user: user._id, active: true });
  if (existing) return { queue: await loadLive(queueId), ticket: existing, created: false };

  const queue = await Queue.findOneAndUpdate({ _id: queueId, status: "open" }, { $inc: { lastSeq: 1 } }, AFTER);
  if (!queue) {
    const current = await Queue.findById(queueId).select("status");
    if (!current) throw NOT_FOUND();
    throw notAccepting(current.status);
  }

  let ticket;
  try {
    ticket = await Ticket.create({
      user: user._id,
      queue: queue._id,
      queueName: queue.name,
      seq: queue.lastSeq,
      token: `${tokenPrefix(queue.name)}-${queue.lastSeq}`,
      status: "waiting",
    });
  } catch (err) {
    // Lost a race against another join by the same user (a double tap). The
    // number reserved above is skipped; tokens stay unique, with a gap.
    if (!isDuplicateKey(err, "user")) throw err;
    const winner = await Ticket.findOne({ queue: queueId, user: user._id, active: true });
    return { queue: await loadLive(queueId), ticket: winner, created: false };
  }

  const after = await Queue.findById(queueId).select("status");
  if (after.status === "closed") {
    await Ticket.updateOne(
      { _id: ticket._id, status: "waiting" },
      { $set: Ticket.transition("cancelled", { completedAt: new Date() }) }
    );
    throw notAccepting("closed");
  }

  return { queue: await loadLive(queueId), ticket, created: true };
}

/** Leaves a queue: cancels the user's waiting ticket. Idempotent. */
async function leaveQueue(queueId, user) {
  const queue = await Queue.findById(queueId);
  if (!queue) throw NOT_FOUND();
  await Ticket.findOneAndUpdate(
    { queue: queue._id, user: user._id, status: "waiting" },
    { $set: Ticket.transition("cancelled", { completedAt: new Date() }) }
  );
  return withLiveState(queue);
}

/** The signed-in user's place in a queue, or 400 if they aren't waiting in it. */
async function userPosition(queueId, user) {
  const queue = await Queue.findById(queueId);
  if (!queue) throw NOT_FOUND();
  const ticket = await Ticket.findOne({ queue: queue._id, user: user._id, status: "waiting" });
  if (!ticket) throw new HttpError(400, "User not in queue", "NOT_IN_QUEUE");
  const totalUsers = await Ticket.countDocuments({ queue: queue._id, status: "waiting" });
  return { queueName: queue.name, position: await positionOf(ticket), totalUsers };
}

/** Active tickets (with live position) plus tickets completed in the last 10 minutes. */
async function userStatus(user) {
  const tickets = await Ticket.find({ user: user._id, active: true }).sort({ createdAt: 1 });
  const queues = await withLiveState(await Queue.find({ _id: { $in: tickets.map((t) => t.queue) } }));
  const queueById = new Map(queues.map((q) => [String(q._id), q]));

  const activeStatus = await Promise.all(
    tickets.map(async (t) => {
      const q = queueById.get(String(t.queue));
      const serving = t.status === "serving";
      const position = serving ? 0 : await positionOf(t);
      return {
        queueId: t.queue,
        queueName: t.queueName,
        queueStatus: q ? q.status : undefined,
        position,
        status: t.status,
        totalInQueue: q ? q.waitingCount : 0,
        token: t.token,
        estimatedWaitTime: serving ? 0 : (position - 1) * 5,
        counter: "01",
        currentlyServing: q && q.nowServing ? q.nowServing.token : "None",
      };
    })
  );

  const recent = await Ticket.find({
    user: user._id,
    status: { $in: ["served", "cancelled"] },
    completedAt: { $gte: new Date(Date.now() - 10 * 60 * 1000) },
  }).sort({ completedAt: -1 });

  const historyStatus = recent.map((t) => ({
    queueId: t.queue,
    queueName: t.queueName,
    position: -1,
    status: t.status,
    totalInQueue: 0,
    token: t.token,
    estimatedWaitTime: 0,
    counter: "Completed",
    currentlyServing: t.token,
  }));

  return [...activeStatus, ...historyStatus];
}

// ---------------------------------------------------------------------------
// Admin actions (ownership is checked by requireQueueOwner before these run)
// ---------------------------------------------------------------------------

/** Moves the queue's serving ticket (if any) to served. Returns true if one was. */
async function completeServing(queueId) {
  const done = await Ticket.findOneAndUpdate(
    { queue: queueId, status: "serving" },
    { $set: Ticket.transition("served", { completedAt: new Date() }) }
  );
  if (done) await Queue.updateOne({ _id: queueId }, { $inc: { servedToday: 1 } });
  return Boolean(done);
}

/**
 * Calls the next person: completes whoever is at the counter, then moves the
 * lowest-numbered waiting ticket to serving. Works while paused (the waiting
 * list is kept and can be worked through), not once closed.
 *
 * The unique "one serving ticket per queue" index means two call-nexts at the
 * same moment can't both pull someone up: the loser gets 409 and nobody is
 * skipped or lost.
 */
async function callNext(queue) {
  if (queue.status === "closed") throw notAccepting("closed");

  const anyoneWaiting = await Ticket.exists({ queue: queue._id, status: "waiting" });
  if (!anyoneWaiting) throw new HttpError(400, "Queue is empty", "QUEUE_EMPTY");

  await completeServing(queue._id);

  try {
    await Ticket.findOneAndUpdate(
      { queue: queue._id, status: "waiting" },
      { $set: Ticket.transition("serving", { startedAt: new Date() }) },
      { sort: { seq: 1 } }
    );
  } catch (err) {
    if (!isDuplicateKey(err)) throw err;
    throw new HttpError(409, "Another call-next for this queue is in progress, please refresh", "CONFLICT");
  }
  return loadLive(queue._id);
}

/** Marks the person at the counter as served. */
async function serveCurrent(queue) {
  const done = await completeServing(queue._id);
  if (!done) throw new HttpError(400, "No user is currently being served", "NOTHING_SERVING");
  return loadLive(queue._id);
}

/** Pause or resume. A closed queue can't be reopened. */
async function setQueueStatus(queue, status) {
  if (status !== "open" && status !== "paused") {
    throw new HttpError(400, 'status must be "open" or "paused" (use close to close a queue)', "VALIDATION_ERROR");
  }
  const updated = await Queue.findOneAndUpdate(
    { _id: queue._id, status: { $ne: "closed" } },
    { $set: { status } },
    AFTER
  );
  if (!updated) throw notAccepting("closed");
  return withLiveState(updated);
}

/**
 * Closes a queue (what "delete" does now). Stops new joins first, then
 * cancels waiting tickets and completes the person at the counter. Tickets
 * are kept, so the queue's history stays in the admin's reports. Idempotent.
 */
async function closeQueue(queue) {
  const now = new Date();
  await Queue.updateOne({ _id: queue._id, status: { $ne: "closed" } }, { $set: { status: "closed", closedAt: now } });

  const cancelled = await Ticket.updateMany(
    { queue: queue._id, status: "waiting" },
    { $set: Ticket.transition("cancelled", { completedAt: now }) }
  );
  const servedCurrent = await completeServing(queue._id);

  return { cancelled: cancelled.modifiedCount, servedCurrent };
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

const ownQueueIds = (adminId) => Queue.find({ admin: adminId }).distinct("_id");

/** Every ticket in the admin's queues (closed ones included), newest first. */
async function usersReport(admin) {
  const queueIds = await ownQueueIds(admin._id);
  const tickets = await Ticket.find({ queue: { $in: queueIds } })
    .populate("user", "name email")
    .sort({ createdAt: -1 });

  // Live positions for waiting tickets, from one ordered read.
  const waiting = await Ticket.find({ queue: { $in: queueIds }, status: "waiting" })
    .sort({ seq: 1 })
    .select("_id queue")
    .lean();
  const rank = new Map();
  const counts = new Map();
  for (const t of waiting) {
    const n = (counts.get(String(t.queue)) || 0) + 1;
    counts.set(String(t.queue), n);
    rank.set(String(t._id), n);
  }

  return tickets.map((t) => {
    const position = rank.get(String(t._id)) || -1;
    return {
      id: t._id,
      name: t.user ? t.user.name : "Unknown",
      token: t.token,
      queueName: t.queueName,
      joinedAt: t.createdAt,
      status: t.status,
      position,
      waitTime: position > 0 ? (position - 1) * 5 : 0,
      queueId: t.queue,
      userId: t.user ? t.user._id : null,
    };
  });
}

async function completedReport(admin) {
  const queueIds = await ownQueueIds(admin._id);
  return Ticket.find({ status: "served", queue: { $in: queueIds } })
    .populate("user", "name email")
    .sort({ completedAt: -1 })
    .limit(20);
}

module.exports = {
  withLiveState,
  listQueues,
  joinQueue,
  leaveQueue,
  userPosition,
  userStatus,
  callNext,
  serveCurrent,
  setQueueStatus,
  closeQueue,
  usersReport,
  completedReport,
};
