/**
 * Socket.io: authenticated connections, rooms the client is entitled to, and
 * small event payloads.
 *
 * Connecting
 *   Browser origins must be in CORS_ORIGINS (checked on the handshake, since
 *   browsers don't apply CORS to WebSockets).
 *   The client passes its JWT in the handshake: io(url, { auth: { token } }).
 *   No valid token (or a deleted account) -> the connection is refused with
 *   connect_error "UNAUTHORIZED". The token is not read from the URL, so it
 *   doesn't end up in proxy or server logs.
 *
 * Rooms (joined by the server, never by name from the client)
 *   user:<id>    every socket of that user. Personal events: ticket:called.
 *   admin:<id>   an admin's sockets. Updates for every queue the admin owns.
 *   users        all regular users. Queue list changes (created, closed, ...).
 *   queue:<id>   joined via "queue:subscribe" after an entitlement check:
 *                admins only for queues they own, users for queues they can
 *                see over REST (any queue that isn't closed).
 *
 * Events sent to clients
 *   queue:update   { queueId, reason, status, waitingCount, nowServing, nextToken }
 *                  nowServing is just the token. No user ids or names.
 *   queues:changed { queueId, reason }               (to "users")
 *   ticket:called  { queueId, queueName, token, calledAt }  (to user:<id> only)
 */
const mongoose = require("mongoose");
const { Server } = require("socket.io");
const Queue = require("../models/Queue");
const { userFromToken } = require("../middleware/auth");

const rooms = {
  user: (id) => `user:${id}`,
  admin: (id) => `admin:${id}`,
  queue: (id) => `queue:${id}`,
  users: "users",
};

/** The only queue fields that go over the socket. */
function queueSummary(queue, reason) {
  return {
    queueId: String(queue._id),
    reason,
    status: queue.status,
    waitingCount: queue.waitingCount ?? 0,
    nowServing: queue.nowServing ? queue.nowServing.token : null,
    nextToken: queue.nextToken ?? null,
  };
}

/** Why `user` may not watch `queueId`, or null if they may. */
async function subscribeRefusal(user, queueId) {
  if (typeof queueId !== "string" || !mongoose.isValidObjectId(queueId) || !/^[0-9a-f]{24}$/i.test(queueId)) {
    return "INVALID_ID";
  }
  const queue = await Queue.findById(queueId).select("admin status").lean();
  if (!queue) return "NOT_FOUND";
  if (user.role === "admin") return queue.admin && queue.admin.equals(user._id) ? null : "FORBIDDEN";
  return queue.status === "closed" ? "FORBIDDEN" : null;
}

function attachSocket(httpServer, { corsOrigins = [] } = {}) {
  const allowed = new Set(corsOrigins);
  const io = new Server(httpServer, {
    // Polling requests are covered by CORS...
    cors: { origin: corsOrigins, methods: ["GET", "POST"], credentials: true },
    // ...but browsers don't apply CORS to WebSocket connections, so the Origin
    // is checked on every handshake too. No Origin (the native app, Node
    // clients) is allowed; the JWT check below still applies to everyone.
    allowRequest: (req, cb) => {
      const origin = req.headers.origin;
      cb(null, !origin || allowed.has(origin));
    },
  });

  io.use(async (socket, next) => {
    try {
      const user = await userFromToken(socket.handshake.auth && socket.handshake.auth.token);
      if (!user) return next(new Error("UNAUTHORIZED"));
      socket.data.user = user;
      return next();
    } catch (err) {
      return next(new Error("SERVER_ERROR"));
    }
  });

  io.on("connection", (socket) => {
    const { user } = socket.data;
    socket.join(rooms.user(user._id));
    socket.join(user.role === "admin" ? rooms.admin(user._id) : rooms.users);

    // ack({ ok: true }) or ack({ ok: false, error }); ack is optional.
    socket.on("queue:subscribe", async (queueId, ack) => {
      const reply = typeof ack === "function" ? ack : () => {};
      try {
        const refusal = await subscribeRefusal(user, queueId);
        if (refusal) return reply({ ok: false, error: refusal });
        socket.join(rooms.queue(queueId));
        return reply({ ok: true });
      } catch {
        return reply({ ok: false, error: "SERVER_ERROR" });
      }
    });

    socket.on("queue:unsubscribe", (queueId, ack) => {
      if (typeof queueId === "string") socket.leave(rooms.queue(queueId));
      if (typeof ack === "function") ack({ ok: true });
    });
  });

  return io;
}

/**
 * Publishes a change to a queue: to everyone watching it and to its owner's
 * admin room (socket.io sends once per socket even if it is in both rooms).
 * `queue` is a live queue (see queueService.withLiveState).
 */
function publishQueue(io, queue, reason) {
  if (!io || !queue) return;
  const payload = queueSummary(queue, reason);
  const ownerId = queue.admin && (queue.admin._id || queue.admin);
  io.to([rooms.queue(payload.queueId), rooms.admin(ownerId)]).emit("queue:update", payload);
  if (["created", "closed", "paused", "resumed"].includes(reason)) {
    io.to(rooms.users).emit("queues:changed", { queueId: payload.queueId, reason });
  }
}

/** Tells one user, on all their devices, that call-next picked them. */
function notifyCalled(io, ticket, queueName) {
  if (!io || !ticket) return;
  io.to(rooms.user(ticket.user)).emit("ticket:called", {
    queueId: String(ticket.queue),
    queueName: queueName || ticket.queueName,
    token: ticket.token,
    calledAt: ticket.calledAt,
  });
}

module.exports = { attachSocket, publishQueue, notifyCalled, queueSummary, rooms };
