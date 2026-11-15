/**
 * Query plans for the main queries, as the code issues them.
 *
 *   npm run bench:explain            # prints a table
 *   npm run bench:explain -- --md    # also prints a Markdown table
 *
 * Seeds a throwaway in-memory MongoDB (never your .env database) with a
 * realistic data set, builds the indexes the models declare, then runs
 * explain("executionStats") on each query and summarises the winning plan:
 * COLLSCAN vs IXSCAN, whether an in-memory SORT was needed, and how many keys
 * and documents were examined for the documents returned.
 *
 * Keep QUERIES in sync with services/queueService.js and routes/.
 */
process.env.JWT_SECRET = process.env.JWT_SECRET || "bench-secret-bench-secret-bench-secret";

const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");
const User = require("../src/models/User");
const Queue = require("../src/models/Queue");
const Ticket = require("../src/models/Ticket");

const DEFAULT_SIZE = { admins: 20, queuesPerAdmin: 10, users: 5000, ticketsPerQueue: 500, waitingPerQueue: 20 };
const DAY = 24 * 60 * 60 * 1000;

async function seed(SIZE = DEFAULT_SIZE) {
  const now = Date.now();
  const users = await User.insertMany(
    Array.from({ length: SIZE.users }, (_, i) => ({ name: `u${i}`, email: `u${i}@bench.com`, password: "x".repeat(60) })),
    { lean: true }
  );
  const admins = await User.insertMany(
    Array.from({ length: SIZE.admins }, (_, i) => ({ name: `a${i}`, email: `a${i}@bench.com`, password: "x".repeat(60), role: "admin" })),
    { lean: true }
  );

  const queues = [];
  admins.forEach((a, ai) => {
    for (let k = 0; k < SIZE.queuesPerAdmin; k += 1) {
      const last = SIZE.queuesPerAdmin - 1;
      queues.push({ name: `Q${ai}-${k}`, admin: a._id, status: k === last ? "closed" : k === last - 1 ? "paused" : "open", lastSeq: SIZE.ticketsPerQueue });
    }
  });
  const qdocs = await Queue.insertMany(queues, { lean: true });

  const finished = ["served", "served", "served", "cancelled", "no_show"];
  const tickets = [];
  qdocs.forEach((q, qi) => {
    const closed = q.status === "closed";
    for (let seq = 1; seq <= SIZE.ticketsPerQueue; seq += 1) {
      const fromEnd = SIZE.ticketsPerQueue - seq;
      let status = finished[seq % finished.length];
      if (!closed && fromEnd < SIZE.waitingPerQueue) status = "waiting";
      if (!closed && fromEnd === SIZE.waitingPerQueue) status = "called";
      // Active tickets use distinct users per queue (the unique index requires it).
      const user = users[(qi * 37 + seq * 13) % users.length]._id;
      const createdAt = new Date(now - ((SIZE.ticketsPerQueue - seq) / SIZE.ticketsPerQueue) * 30 * DAY);
      const done = !["waiting", "called"].includes(status);
      tickets.push({
        user,
        queue: q._id,
        queueName: q.name,
        seq,
        token: `Q-${seq}`,
        ...Ticket.transition(status),
        joinedAt: createdAt,
        createdAt,
        updatedAt: createdAt,
        ...(status === "called" && { calledAt: new Date(now - 60000) }),
        ...(done && { completedAt: new Date(createdAt.getTime() + 20 * 60000) }),
      });
    }
  });
  for (let i = 0; i < tickets.length; i += 10000) {
    await Ticket.collection.insertMany(tickets.slice(i, i + 10000));
  }
  return { admins, qdocs };
}

/** Picks realistic arguments from the seeded data. */
async function samples({ admins, qdocs }) {
  const admin = admins[Math.min(3, admins.length - 1)];
  const adminQueueIds = qdocs.filter((q) => String(q.admin) === String(admin._id)).map((q) => q._id);
  const queue = qdocs.find((q) => String(q.admin) === String(admin._id) && q.status === "open");
  const waiting = await Ticket.findOne({ queue: queue._id, status: "waiting" }).sort({ seq: -1 }).lean();
  return { admin, adminQueueIds, queue, waiting, userId: waiting.user, email: "u1@bench.com" };
}

const FINISHED = ["served", "cancelled", "no_show"];

// [name, where in the code, () => query or aggregate]
const QUERIES = (s) => [
  ["Queue list (admin)", "listQueues", () => Queue.find({ status: { $ne: "closed" }, admin: s.admin._id })],
  ["Queue list (user)", "listQueues", () => Queue.find({ status: { $ne: "closed" } })],
  ["Admin's queue ids (reports)", "ownQueueIds / statsReport", () => Queue.find({ admin: s.admin._id }, { _id: 1 })],
  ["Already joined?", "joinQueue", () => Ticket.findOne({ queue: s.queue._id, user: s.userId, active: true })],
  ["Live state of admin's queues", "withLiveState", () => Ticket.find({ queue: { $in: s.adminQueueIds }, active: true }).sort({ seq: 1 })],
  ["Position (people ahead)", "positionOf", () => Ticket.find({ queue: s.queue._id, status: "waiting", seq: { $lt: s.waiting.seq } })],
  ["User's waiting ticket", "leaveQueue / userPosition", () => Ticket.findOne({ queue: s.queue._id, user: s.userId, status: "waiting", active: true })],
  ["My active tickets", "userStatus", () => Ticket.find({ user: s.userId, active: true }).sort({ createdAt: 1 })],
  ["My recently finished", "userStatus", () => Ticket.find({ user: s.userId, status: { $in: FINISHED }, completedAt: { $gte: new Date(Date.now() - 10 * 60000) } }).sort({ completedAt: -1 })],
  ["My history", "GET /my-history", () => Ticket.find({ user: s.userId, status: { $in: FINISHED } }).sort({ createdAt: -1 })],
  ["Ticket at the counter", "finishAtCounter", () => Ticket.findOne({ queue: s.queue._id, atCounter: true })],
  ["Next to call", "callNext", () => Ticket.findOne({ queue: s.queue._id, status: "waiting" }).sort({ seq: 1 })],
  ["Users report", "usersReport", () => Ticket.find({ queue: { $in: s.adminQueueIds } }).sort({ createdAt: -1 })],
  ["Completed report (top 20)", "completedReport", () => Ticket.find({ status: "served", queue: { $in: s.adminQueueIds } }).sort({ completedAt: -1 }).limit(20)],
  ["Stats per status", "statsReport", () => Ticket.aggregate([{ $match: { queue: { $in: s.adminQueueIds } } }, { $group: { _id: { queue: "$queue", status: "$status" }, n: { $sum: 1 } } }])],
  ["Login lookup", "POST /login", () => User.findOne({ email: s.email })],
];

/** Stage names (and index names) of a plan tree, outermost first. */
function stages(plan, out = []) {
  if (!plan) return out;
  const p = plan.queryPlan || plan; // SBE wraps the classic tree
  // EXPRESS_IXSCAN: MongoDB 8's fast path for equality on a unique index.
  const stage = p.stage === "EXPRESS_IXSCAN" ? "IXSCAN" : p.stage;
  const name = p.indexName || (p.keyPattern ? Object.keys(p.keyPattern).map((k) => `${k}_${p.keyPattern[k]}`).join("_") : "");
  out.push(name ? `${stage}(${name})` : stage);
  if (p.inputStage) stages(p.inputStage, out);
  (p.inputStages || []).forEach((c) => stages(c, out));
  return out;
}

function summarise(exp) {
  // find(): { queryPlanner, executionStats }. aggregate(): { stages: [{ $cursor: {...} }] } or same top-level.
  const cursor = exp.stages ? exp.stages[0].$cursor : exp;
  const plan = stages(cursor.queryPlanner.winningPlan);
  const st = cursor.executionStats || {};
  const hasSort = plan.some((x) => x === "SORT") || (exp.stages || []).some((x) => x.$sort);
  return {
    scan: plan.some((x) => x.startsWith("COLLSCAN")) ? "COLLSCAN" : "IXSCAN",
    index: (plan.find((x) => x.startsWith("IXSCAN")) || "").replace(/^IXSCAN\((.*)\)$/, "$1") || "-",
    sort: hasSort ? "in memory" : "-",
    returned: st.nReturned,
    keys: st.totalKeysExamined,
    docs: st.totalDocsExamined,
  };
}

/** Runs every query's explain and returns one summary row per query. */
async function explainAll(s) {
  const rows = [];
  for (const [name, where, q] of QUERIES(s)) {
    const exp = await q().explain("executionStats");
    rows.push({ query: name, code: where, ...summarise(Array.isArray(exp) ? exp[0] : exp) });
  }
  return rows;
}

module.exports = { seed, samples, explainAll, DEFAULT_SIZE };

if (require.main === module) {
  (async () => {
    const mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri(), { dbName: "queueease-explain" });
    await Promise.all([User, Queue, Ticket].map((m) => m.init())); // build declared indexes
    const data = await seed();
    const rows = await explainAll(await samples(data));
    const total = await Ticket.estimatedDocumentCount();

    console.log(`\n${total} tickets, ${data.qdocs.length} queues, ${DEFAULT_SIZE.users + DEFAULT_SIZE.admins} users\n`);
    console.table(rows);
    if (process.argv.includes("--md")) {
      console.log("| Query | Code | Plan | Index | Sort | Returned | Keys examined | Docs examined |");
      console.log("|---|---|---|---|---|---|---|---|");
      rows.forEach((r) => console.log(`| ${r.query} | \`${r.code}\` | ${r.scan} | ${r.index === "-" ? "-" : `\`${r.index}\``} | ${r.sort} | ${r.returned} | ${r.keys} | ${r.docs} |`));
    }

    await mongoose.disconnect();
    await mongod.stop();
  })().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
