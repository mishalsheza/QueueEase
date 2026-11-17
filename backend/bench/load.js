/**
 * Load test: N concurrent users with authenticated sockets, joining, leaving
 * and being called in the same queues.
 *
 *   npm run bench:load                     # N = 100, 250, 500, 1000
 *   LEVELS=250 DURATION=30 npm run bench:load
 *   OUT=/tmp/load.json npm run bench:load  # also write the raw numbers
 *   SUBSCRIBE=0 LEVELS=1000 npm run bench:load
 *       diagnostic: users don't join queue rooms, so joins aren't fanned out
 *       (isolates the cost of socket broadcasts from the database work)
 *
 * Local only, by construction: it takes no URL. For every level it starts its
 * own copy of the real server (node src/server.js, a separate process) against
 * a throwaway MongoDB (mongodb-memory-server), from a temp directory so
 * backend/.env (which may point at Atlas) is never read. Nothing is sent to
 * Render or any other remote host.
 *
 * Setup per level: QUEUES queues (one admin each), N users split evenly across
 * them. Every user and admin opens a WebSocket with its JWT, as the app does,
 * and users subscribe to their queue's room.
 *
 * Phases
 *   connect   all N sockets connect at once
 *   burst     all N users join their queue at once
 *   position  all N ask for their position at once (must be exactly 1..k per queue)
 *   churn     DURATION seconds: each user waits a random think time (mean
 *             THINK_MS), then joins if out of the queue or leaves if waiting;
 *             each admin loops call-next, wait, serve, wait (CALL_GAP_MS)
 *             Expected answers, not errors: call-next and serve return 400
 *             when the queue or the counter is empty.
 *
 * Measured
 *   latency           p50 / p95 / p99 per operation, from request sent to response
 *   called event      call-next sent -> the called user's ticket:called arrives
 *   fan-out           call-next sent -> each subscriber of that queue receives the
 *                     queue:update for it; "delivered" = share of subscribers
 *                     that got it (should be 100%)
 *   errors            5xx, timeouts (REQUEST_TIMEOUT_MS), network errors, socket
 *                     connect failures and disconnects. 400 QUEUE_EMPTY and 409
 *                     are expected answers, counted separately
 *   integrity         from the database afterwards: duplicate tokens or seqs in a
 *                     queue, users with two active tickets in one queue, more than
 *                     one person at a counter
 *   resources         server CPU % (100% = one core, Node's limit) and peak RSS,
 *                     sampled every second; the load generator's own event-loop
 *                     lag, to tell a slow server from a saturated client
 */
const { spawn, execFile } = require("child_process");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const fs = require("fs");
const { monitorEventLoopDelay } = require("perf_hooks");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { MongoMemoryServer } = require("mongodb-memory-server");
const { io: ioClient } = require("socket.io-client");
const User = require("../src/models/User");
const Ticket = require("../src/models/Ticket");
const { DB_NAME } = require("../src/config/db");

const LEVELS = (process.env.LEVELS || "100,250,500,1000").split(",").map(Number);
const QUEUES = Number(process.env.QUEUES || 5);
const DURATION = Number(process.env.DURATION || 20); // seconds of churn
const THINK_MS = Number(process.env.THINK_MS || 5000); // mean user think time
const CALL_GAP_MS = Number(process.env.CALL_GAP_MS || 500); // admin: call-next, gap, serve, gap
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || 10000);
const SUBSCRIBE = process.env.SUBSCRIBE !== "0"; // diagnostic: SUBSCRIBE=0 skips queue rooms (no fan-out)
const SERVER = path.join(__dirname, "..", "src", "server.js");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pct = (arr, p) => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
};
const summary = (arr) => ({ n: arr.length, p50: pct(arr, 50), p95: pct(arr, 95), p99: pct(arr, 99), max: arr.length ? Math.max(...arr) : null });
const ms = (v) => (v === null || v === undefined ? "-" : `${Math.round(v)}`);

// ---------------------------------------------------------------- server ---

async function startServer(mongoUri, secret) {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "qe-load-")); // no .env here
  const env = {
    PATH: process.env.PATH,
    MONGO_URI: mongoUri,
    JWT_SECRET: secret,
    CORS_ORIGINS: "http://localhost:8081",
    PORT: String(port),
    AUTH_RATE_LIMIT_MAX: "1000000",
  };
  if (!/^mongodb:\/\/127\.0\.0\.1:/.test(mongoUri)) throw new Error(`refusing a non-local database: ${mongoUri}`);
  const child = spawn(process.execPath, [SERVER], { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
  let log = "";
  child.stdout.on("data", (d) => { log += d; });
  child.stderr.on("data", (d) => { log += d; });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i += 1) {
    try {
      if ((await fetch(`${base}/api/health`)).ok) return { child, base, log: () => log };
    } catch { /* not up yet */ }
    if (child.exitCode !== null) break;
    await sleep(100);
  }
  child.kill();
  throw new Error(`server did not start:\n${log}`);
}

/** Samples the server process's CPU % and RSS once a second. */
function sampleProcess(pid) {
  const samples = [];
  const timer = setInterval(() => {
    execFile("ps", ["-o", "%cpu=,rss=", "-p", String(pid)], (err, out) => {
      if (err) return;
      const [cpu, rss] = out.trim().split(/\s+/).map(Number);
      if (!Number.isNaN(cpu)) samples.push({ cpu, rssMb: rss / 1024 });
    });
  }, 1000);
  return { stop: () => clearInterval(timer), samples };
}

// ---------------------------------------------------------------- client ---

const networkCodes = {}; // why "network" errors happened, e.g. ECONNRESET

function makeClient(base, stats) {
  return async function call(op, method, url, token, body) {
    const t0 = performance.now();
    let status = 0;
    let json = null;
    try {
      const res = await fetch(base + url, {
        method,
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      status = res.status;
      json = await res.json().catch(() => null);
    } catch (err) {
      status = err.name === "TimeoutError" ? "timeout" : "network";
      if (status === "network") {
        const code = (err.cause && (err.cause.code || err.cause.message)) || err.message;
        networkCodes[code] = (networkCodes[code] || 0) + 1;
      }
    }
    const dt = performance.now() - t0;
    const s = (stats[op] ||= { latency: [], status: {} });
    s.status[status] = (s.status[status] || 0) + 1;
    if (typeof status === "number" && status < 500) s.latency.push(dt);
    return { status, json, t0 };
  };
}

function connectSocket(base, token, onEvent, counters) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const s = ioClient(base, { auth: { token }, transports: ["websocket"], reconnection: false, timeout: REQUEST_TIMEOUT_MS });
    s.onAny((event, payload) => onEvent(event, payload, performance.now()));
    s.on("disconnect", (reason) => { if (!s.closing) counters.disconnects.push(reason); });
    s.once("connect", () => resolve({ socket: s, ms: performance.now() - t0 }));
    s.once("connect_error", (e) => { counters.connectErrors.push(e.message); resolve({ socket: s, ms: null }); });
  });
}

// ----------------------------------------------------------------- level ---

async function runLevel(N, mongo) {
  Object.keys(networkCodes).forEach((k) => delete networkCodes[k]);
  const secret = crypto.randomBytes(32).toString("hex");
  const uri = mongo.getUri();
  // A fresh database per level: drop everything the previous level left.
  await mongoose.connect(uri, { dbName: DB_NAME });
  await mongoose.connection.dropDatabase();
  await Promise.all([User.init(), Ticket.init()]);

  const server = await startServer(uri, secret);
  const call = makeClient(server.base, {});
  const stats = {};
  const callFn = makeClient(server.base, stats);
  const counters = { connectErrors: [], disconnects: [] };
  const sign = (u) => jwt.sign({ id: u._id, role: u.role }, secret, { expiresIn: "1h" });

  // Accounts straight into the database (the password is never used: the
  // bench signs tokens with the server's secret, like a login would).
  const password = await bcrypt.hash("load-test-password", 4);
  const admins = await User.insertMany(
    Array.from({ length: QUEUES }, (_, i) => ({ name: `Load Admin ${i}`, email: `load-admin-${i}@example.com`, password, role: "admin" }))
  );
  const users = await User.insertMany(
    Array.from({ length: N }, (_, i) => ({ name: `Load User ${i}`, email: `load-user-${i}@example.com`, password, role: "user" }))
  );

  // Queues through the API, as an admin would create them.
  const queues = [];
  for (let i = 0; i < QUEUES; i += 1) {
    const r = await call("create", "POST", "/api/queues", sign(admins[i]), { name: `Load Desk ${i}`, type: "Dental Care", section: "A" });
    if (r.status !== 201) throw new Error(`create queue failed: ${r.status} ${JSON.stringify(r.json)}`);
    queues.push({ id: String(r.json._id || r.json.queue?._id), admin: admins[i], token: sign(admins[i]), subscribers: 0 });
  }

  // Events: queue:update "called" per (queue, token) and ticket:called per token.
  const fanout = new Map(); // `${queueId}|${token}` -> [receive times]
  const calledEvents = new Map(); // `${queueId}|${token}` -> receive time
  const onEvent = (event, payload, at) => {
    if (event === "queue:update" && payload.reason === "called" && payload.nowServing) {
      const key = `${payload.queueId}|${payload.nowServing}`;
      if (!fanout.has(key)) fanout.set(key, []);
      fanout.get(key).push(at);
    } else if (event === "ticket:called") {
      calledEvents.set(`${payload.queueId}|${payload.token}`, at);
    }
  };

  const loop = monitorEventLoopDelay({ resolution: 10 });
  loop.enable();
  const cpu = sampleProcess(server.child.pid);

  // --- connect: all users and admins at once
  const people = users.map((u, i) => ({ user: u, token: sign(u), queue: queues[i % QUEUES], state: "out" }));
  const connectStart = performance.now();
  const conns = await Promise.all([
    ...people.map((p) => connectSocket(server.base, p.token, onEvent, counters)),
    ...queues.map((q) => connectSocket(server.base, q.token, () => {}, counters)),
  ]);
  const connectWall = performance.now() - connectStart;
  const connectMs = conns.map((c) => c.ms).filter((v) => v !== null);
  const sockets = conns.map((c) => c.socket);

  // Users watch their queue's room, as the dashboard does.
  const subs = await Promise.all(
    people.map((p, i) => new Promise((resolve) => {
      if (!SUBSCRIBE) return resolve(false);
      sockets[i].timeout(REQUEST_TIMEOUT_MS).emit("queue:subscribe", p.queue.id, (err, ack) => resolve(!err && ack && ack.ok));
    }))
  );
  people.forEach((p, i) => { if (subs[i]) p.queue.subscribers += 1; });
  const subscribeFailures = SUBSCRIBE ? subs.filter((ok) => !ok).length : 0;

  // --- burst: everyone joins at once
  const burstStart = performance.now();
  const burst = await Promise.all(people.map((p) => callFn("join (burst)", "POST", `/api/queues/${p.queue.id}/join`, p.token)));
  const burstWall = performance.now() - burstStart;
  burst.forEach((r, i) => { if (r.status === 200) people[i].state = "waiting"; });

  // --- position: everyone asks at once; each queue must read exactly 1..k
  const positions = await Promise.all(people.map((p) => callFn("position", "GET", `/api/queues/${p.queue.id}/position`, p.token)));
  let positionProblems = 0;
  for (const q of queues) {
    const mine = people.map((p, i) => ({ p, r: positions[i] })).filter(({ p }) => p.queue === q);
    const got = mine.map(({ r }) => r.json && r.json.position).filter((v) => typeof v === "number").sort((a, b) => a - b);
    const k = mine.length;
    const exact = got.length === k && got.every((v, idx) => v === idx + 1) && mine.every(({ r }) => r.json && r.json.totalUsers === k);
    if (!exact) positionProblems += 1;
  }

  // --- churn
  const calls = []; // { queueId, t0, token }
  let running = true;
  const until = performance.now() + DURATION * 1000;
  const think = () => -Math.log(1 - Math.random()) * THINK_MS; // exponential, mean THINK_MS
  const nap = (t) => sleep(Math.max(0, Math.min(t, until - performance.now()))); // never past the end

  const userLoop = async (p) => {
    await nap(Math.random() * THINK_MS);
    while (running && performance.now() < until) {
      if (p.state === "waiting") {
        const r = await callFn("leave", "POST", `/api/queues/${p.queue.id}/leave`, p.token);
        if (r.status === 200) p.state = "out";
      } else {
        const r = await callFn("join", "POST", `/api/queues/${p.queue.id}/join`, p.token);
        if (r.status === 200) p.state = "waiting";
      }
      await nap(think());
    }
  };
  const adminLoop = async (q) => {
    while (running && performance.now() < until) {
      const r = await callFn("call-next", "POST", `/api/queues/${q.id}/call-next`, q.token);
      const token = r.json && r.json.queue && r.json.queue.nowServing && r.json.queue.nowServing.token;
      if (r.status === 200 && token) calls.push({ queueId: q.id, t0: r.t0, token });
      await nap(CALL_GAP_MS);
      await callFn("serve", "POST", `/api/queues/${q.id}/serve`, q.token, {});
      await nap(CALL_GAP_MS);
    }
  };
  const churnStart = performance.now();
  await Promise.all([...people.map(userLoop), ...queues.map(adminLoop)]);
  running = false;
  const churnWall = performance.now() - churnStart;
  await sleep(2000); // let the last events arrive

  // --- socket delivery
  const calledLatency = [];
  const fanoutLatency = [];
  let calledMissing = 0;
  let fanoutExpected = 0;
  let fanoutDelivered = 0;
  for (const c of calls) {
    const key = `${c.queueId}|${c.token}`;
    const at = calledEvents.get(key);
    if (at === undefined) calledMissing += 1; else calledLatency.push(at - c.t0);
    const got = fanout.get(key) || [];
    const q = queues.find((x) => x.id === c.queueId);
    fanoutExpected += q.subscribers;
    fanoutDelivered += Math.min(got.length, q.subscribers);
    got.forEach((t) => fanoutLatency.push(t - c.t0));
  }

  // --- integrity, straight from the database
  const dupTokens = await Ticket.aggregate([{ $group: { _id: { q: "$queue", t: "$token" }, n: { $sum: 1 } } }, { $match: { n: { $gt: 1 } } }]);
  const dupSeqs = await Ticket.aggregate([{ $match: { seq: { $ne: null } } }, { $group: { _id: { q: "$queue", s: "$seq" }, n: { $sum: 1 } } }, { $match: { n: { $gt: 1 } } }]);
  const doubleActive = await Ticket.aggregate([{ $match: { active: true } }, { $group: { _id: { q: "$queue", u: "$user" }, n: { $sum: 1 } } }, { $match: { n: { $gt: 1 } } }]);
  const twoAtCounter = await Ticket.aggregate([{ $match: { atCounter: true } }, { $group: { _id: "$queue", n: { $sum: 1 } } }, { $match: { n: { $gt: 1 } } }]);
  const tickets = await Ticket.countDocuments();

  // --- teardown
  cpu.stop();
  loop.disable();
  sockets.forEach((s) => { s.closing = true; s.close(); });
  server.child.kill();
  await new Promise((r) => server.child.once("exit", r));
  await mongoose.disconnect();

  const requests = Object.values(stats).reduce((n, s) => n + Object.values(s.status).reduce((a, b) => a + b, 0), 0);
  const churnRequests = ["join", "leave", "call-next", "serve"].reduce(
    (n, op) => n + Object.values((stats[op] || { status: {} }).status).reduce((a, b) => a + b, 0), 0);
  const errors = Object.fromEntries(
    Object.entries(stats).map(([op, s]) => [op, Object.entries(s.status).filter(([k]) => k === "timeout" || k === "network" || Number(k) >= 500).reduce((n, [, v]) => n + v, 0)])
  );

  return {
    N,
    queues: QUEUES,
    usersPerQueue: N / QUEUES,
    connect: { wallMs: connectWall, ...summary(connectMs), failures: counters.connectErrors.length, subscribeFailures },
    burst: { wallMs: burstWall, ...summary(stats["join (burst)"].latency), status: stats["join (burst)"].status },
    position: { ...summary(stats.position.latency), queuesNotExactly1toK: positionProblems },
    churn: {
      seconds: churnWall / 1000,
      requestsPerSecond: churnRequests / (churnWall / 1000),
      ops: Object.fromEntries(["join", "leave", "call-next", "serve"].map((op) => [op, { ...summary((stats[op] || { latency: [] }).latency), status: (stats[op] || {}).status }])),
    },
    sockets: {
      callsMade: calls.length,
      calledEvent: { ...summary(calledLatency), missing: calledMissing },
      fanout: { ...summary(fanoutLatency), expected: fanoutExpected, delivered: fanoutDelivered, deliveredPct: fanoutExpected ? (100 * fanoutDelivered) / fanoutExpected : 100 },
      disconnects: counters.disconnects.length,
    },
    errors: { byOp: errors, networkCodes: { ...networkCodes }, total: Object.values(errors).reduce((a, b) => a + b, 0) + counters.connectErrors.length + counters.disconnects.length + subscribeFailures },
    integrity: { tickets, duplicateTokens: dupTokens.length, duplicateSeqs: dupSeqs.length, doubleActiveTickets: doubleActive.length, queuesWithTwoAtCounter: twoAtCounter.length },
    server: {
      cpuAvgPct: cpu.samples.length ? cpu.samples.reduce((a, s) => a + s.cpu, 0) / cpu.samples.length : null,
      cpuMaxPct: cpu.samples.length ? Math.max(...cpu.samples.map((s) => s.cpu)) : null,
      rssPeakMb: cpu.samples.length ? Math.max(...cpu.samples.map((s) => s.rssMb)) : null,
    },
    client: { eventLoopLagP99Ms: loop.percentile(99) / 1e6, eventLoopLagMaxMs: loop.max / 1e6 },
    requests,
  };
}

// ------------------------------------------------------------------ main ---

function print(r) {
  const o = r.churn.ops;
  console.log(`\n=== N = ${r.N} users (${r.queues} queues x ${r.usersPerQueue}) ===`);
  console.log(`connect     all ${r.N + r.queues} sockets in ${ms(r.connect.wallMs)} ms  p50 ${ms(r.connect.p50)}  p95 ${ms(r.connect.p95)}  failures ${r.connect.failures}  subscribe failures ${r.connect.subscribeFailures}`);
  console.log(`burst join  ${r.N} at once in ${ms(r.burst.wallMs)} ms  p50 ${ms(r.burst.p50)}  p95 ${ms(r.burst.p95)}  p99 ${ms(r.burst.p99)}  status ${JSON.stringify(r.burst.status)}`);
  console.log(`position    p50 ${ms(r.position.p50)}  p95 ${ms(r.position.p95)}  queues not exactly 1..k: ${r.position.queuesNotExactly1toK}`);
  console.log(`churn       ${r.churn.seconds.toFixed(1)} s, ${r.churn.requestsPerSecond.toFixed(0)} req/s`);
  for (const op of ["join", "leave", "call-next", "serve"]) {
    console.log(`  ${op.padEnd(10)} n ${String(o[op].n).padStart(5)}  p50 ${ms(o[op].p50).padStart(5)}  p95 ${ms(o[op].p95).padStart(5)}  p99 ${ms(o[op].p99).padStart(5)}  max ${ms(o[op].max).padStart(5)}  status ${JSON.stringify(o[op].status)}`);
  }
  const s = r.sockets;
  console.log(`ticket:called  ${s.calledEvent.n} of ${s.callsMade} calls  p50 ${ms(s.calledEvent.p50)}  p95 ${ms(s.calledEvent.p95)}  max ${ms(s.calledEvent.max)}  missing ${s.calledEvent.missing}`);
  console.log(`queue:update   fan-out p50 ${ms(s.fanout.p50)}  p95 ${ms(s.fanout.p95)}  max ${ms(s.fanout.max)}  delivered ${s.fanout.delivered}/${s.fanout.expected} (${s.fanout.deliveredPct.toFixed(1)}%)  disconnects ${s.disconnects}`);
  console.log(`errors      ${r.errors.total} ${JSON.stringify(r.errors.byOp)}${Object.keys(r.errors.networkCodes).length ? `  network: ${JSON.stringify(r.errors.networkCodes)}` : ""}`);
  console.log(`integrity   ${JSON.stringify(r.integrity)}`);
  console.log(`server      cpu avg ${r.server.cpuAvgPct?.toFixed(0)}%  max ${r.server.cpuMaxPct?.toFixed(0)}%  rss peak ${r.server.rssPeakMb?.toFixed(0)} MB   client loop lag p99 ${r.client.eventLoopLagP99Ms.toFixed(0)} ms  max ${r.client.eventLoopLagMaxMs.toFixed(0)} ms`);
}

(async () => {
  console.log(`Load test: levels ${LEVELS.join(", ")}; ${QUEUES} queues; churn ${DURATION}s, think ~${THINK_MS}ms, admin gap ${CALL_GAP_MS}ms${SUBSCRIBE ? "" : "; SUBSCRIBE=0 (no queue rooms)"}`);
  console.log(`Machine: ${os.cpus()[0].model}, ${os.cpus().length} cores, ${(os.totalmem() / 2 ** 30).toFixed(0)} GB, Node ${process.version}`);
  const mongo = await MongoMemoryServer.create();
  const results = [];
  try {
    for (const N of LEVELS) {
      const r = await runLevel(N, mongo);
      print(r);
      results.push(r);
    }
  } finally {
    await mongo.stop();
  }
  if (process.env.OUT) {
    fs.writeFileSync(process.env.OUT, JSON.stringify({ machine: { cpu: os.cpus()[0].model, cores: os.cpus().length, memGb: os.totalmem() / 2 ** 30, node: process.version }, settings: { QUEUES, DURATION, THINK_MS, CALL_GAP_MS }, results }, null, 2));
    console.log(`\nraw results: ${process.env.OUT}`);
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
