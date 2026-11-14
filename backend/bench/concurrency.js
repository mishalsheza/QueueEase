/**
 * Concurrency benchmark for the queue API.
 *
 *   npm run bench:concurrency            # 5 rounds
 *   ROUNDS=10 npm run bench:concurrency
 *
 * Starts the real Express app on a random port against a throwaway in-memory
 * MongoDB (never your .env database) and fires real concurrent HTTP requests.
 * It only uses endpoints that existed before and after the A4 queue redesign
 * (create, join, leave, call-next, list, users-report), so the same script
 * measures both versions.
 *
 * Scenarios, per round:
 *   burst   50 users join one queue at the same moment
 *   churn   10 waiting; then 15 steps of call-next + join + leave fired together
 *   taps    20 users each tap Join 5 times at once (100 requests)
 *   storm   30 users each send join, leave, join, leave at once (120 requests)
 *
 * Counted:
 *   duplicate tokens   tickets in one queue sharing a token with another ticket
 *   double joins       users holding more than one active ticket in a queue,
 *                      plus duplicate entries in the queue's waiting list
 *   out of sync        queue waiting list and active tickets disagree
 *   5xx / network      server errors and dropped connections (crash signal)
 *   409                requests rejected as a conflict (not an error)
 */
process.env.JWT_SECRET = process.env.JWT_SECRET || "bench-secret";
process.env.NODE_ENV = "test";

const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const { MongoMemoryServer } = require("mongodb-memory-server");
const app = require("../src/app");
const User = require("../src/models/User");

const ROUNDS = Number(process.env.ROUNDS || 5);
let base;
let hash;
let userCounter = 0;

const stats = () => ({ requests: 0, s5xx: 0, network: 0, s409: 0 });

async function call(st, method, url, token, body) {
  st.requests += 1;
  try {
    const res = await fetch(base + url, {
      method,
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(5000), // a request that never gets an answer counts as dropped
    });
    if (res.status >= 500) st.s5xx += 1;
    if (res.status === 409) st.s409 += 1;
    const text = await res.text();
    try {
      return { status: res.status, body: JSON.parse(text) };
    } catch {
      return { status: res.status, body: text };
    }
  } catch {
    st.network += 1;
    return { status: 0 };
  }
}

async function makeUsers(n, role = "user") {
  const docs = Array.from({ length: n }, () => {
    userCounter += 1;
    return { name: `${role} ${userCounter}`, email: `${role}${userCounter}@bench.com`, password: hash, role };
  });
  const users = await User.insertMany(docs); // pre-hashed; skips per-user bcrypt
  return users.map((u) => ({ id: u._id.toString(), token: jwt.sign({ id: u._id, role }, process.env.JWT_SECRET) }));
}

/** Reads the queue's tickets (users-report) and waiting list (GET /queues). */
async function inspect(admin, queueId) {
  const st = stats();
  const report = (await call(st, "GET", "/api/queues/admin/users-report", admin.token)).body;
  const queues = (await call(st, "GET", "/api/queues", admin.token)).body;
  const tickets = report.filter((t) => String(t.queueId) === queueId);
  const queue = queues.find((q) => q._id === queueId) || { users: [] };

  const tokenCounts = {};
  tickets.forEach((t) => (tokenCounts[t.token] = (tokenCounts[t.token] || 0) + 1));
  const duplicateTokens = Object.values(tokenCounts).reduce((s, c) => s + (c > 1 ? c - 1 : 0), 0);

  const active = tickets.filter((t) => ["waiting", "called", "serving"].includes(t.status));
  const activePerUser = {};
  active.forEach((t) => (activePerUser[t.userId] = (activePerUser[t.userId] || 0) + 1));
  const extraTickets = Object.values(activePerUser).reduce((s, c) => s + (c > 1 ? c - 1 : 0), 0);

  const listIds = queue.users.map((u) => String(u.user));
  const extraListEntries = listIds.length - new Set(listIds).size;

  const waitingTicketUsers = new Set(tickets.filter((t) => t.status === "waiting").map((t) => String(t.userId)));
  const listSet = new Set(listIds);
  const outOfSync =
    [...listSet].filter((id) => !waitingTicketUsers.has(id)).length +
    [...waitingTicketUsers].filter((id) => !listSet.has(id)).length;

  return { duplicateTokens, doubleJoins: extraTickets + extraListEntries, outOfSync };
}

async function newQueue(admin, name) {
  const st = stats();
  return (await call(st, "POST", "/api/queues", admin.token, { name })).body._id;
}

async function burst(admin) {
  const st = stats();
  const q = await newQueue(admin, "Burst");
  const users = await makeUsers(50);
  await Promise.all(users.map((u) => call(st, "POST", `/api/queues/${q}/join`, u.token)));
  return { ...st, ...(await inspect(admin, q)) };
}

async function churn(admin) {
  const st = stats();
  const q = await newQueue(admin, "Churn");
  const first = await makeUsers(10);
  for (const u of first) await call(st, "POST", `/api/queues/${q}/join`, u.token);
  const waiting = [...first];
  const extra = await makeUsers(15);
  for (let i = 0; i < 15; i += 1) {
    const leaver = waiting.splice(waiting.length - 1, 1)[0];
    const joiner = extra[i];
    await Promise.all([
      call(st, "POST", `/api/queues/${q}/call-next`, admin.token),
      call(st, "POST", `/api/queues/${q}/join`, joiner.token),
      leaver ? call(st, "POST", `/api/queues/${q}/leave`, leaver.token) : null,
    ]);
    waiting.shift();
    waiting.push(joiner);
  }
  return { ...st, ...(await inspect(admin, q)) };
}

async function taps(admin) {
  const st = stats();
  const q = await newQueue(admin, "Taps");
  const users = await makeUsers(20);
  await Promise.all(users.flatMap((u) => Array.from({ length: 5 }, () => call(st, "POST", `/api/queues/${q}/join`, u.token))));
  return { ...st, ...(await inspect(admin, q)) };
}

async function storm(admin) {
  const st = stats();
  const q = await newQueue(admin, "Storm");
  const users = await makeUsers(30);
  await Promise.all(
    users.flatMap((u) =>
      ["join", "leave", "join", "leave"].map((a) => call(st, "POST", `/api/queues/${q}/${a}`, u.token))
    )
  );
  return { ...st, ...(await inspect(admin, q)) };
}

const SCENARIOS = { burst, churn, taps, storm };
const FIELDS = ["requests", "duplicateTokens", "doubleJoins", "outOfSync", "s5xx", "network", "s409"];

(async () => {
  const mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri(), { dbName: "queueease-bench" });
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  hash = await bcrypt.hash("bench-pass", 4);

  const server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  const [admin] = await makeUsers(1, "admin");

  const totals = {};
  for (let r = 0; r < ROUNDS; r += 1) {
    for (const [name, fn] of Object.entries(SCENARIOS)) {
      const res = await fn(admin);
      totals[name] = totals[name] || Object.fromEntries(FIELDS.map((f) => [f, 0]));
      FIELDS.forEach((f) => (totals[name][f] += res[f] || 0));
    }
  }

  const health = await fetch(base + "/").then((r) => r.status).catch(() => 0);
  console.log(`\nConcurrency benchmark, ${ROUNDS} rounds (totals across rounds)\n`);
  console.table(totals);
  const sum = (f) => Object.values(totals).reduce((s, t) => s + t[f], 0);
  console.log(
    JSON.stringify({
      rounds: ROUNDS,
      requests: sum("requests"),
      duplicateTokens: sum("duplicateTokens"),
      doubleJoins: sum("doubleJoins"),
      outOfSync: sum("outOfSync"),
      serverErrors5xx: sum("s5xx"),
      droppedConnections: sum("network"),
      conflicts409: sum("s409"),
      serverAliveAfter: health === 200,
    })
  );

  server.close();
  await mongoose.disconnect();
  await mongod.stop();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
