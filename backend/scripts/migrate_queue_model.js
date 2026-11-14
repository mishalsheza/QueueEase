/**
 * Moves existing data to the Ticket-first queue model (plan item A4).
 *
 *   node scripts/migrate_queue_model.js           # dry run: prints what would change
 *   node scripts/migrate_queue_model.js --apply   # writes the changes
 *
 * Never deletes anything and is safe to run more than once. Run it once
 * against each database that has data from before A4, before starting the
 * new server on it.
 *
 * What it does:
 *   Queues   status "open" if missing, lastSeq set from their tickets,
 *            old users[] / nowServing fields removed (tickets replace them).
 *            Anyone in users[] or nowServing without a matching ticket gets one.
 *   Tickets  numbered (seq) in join order where missing, `active` set from status.
 *            Leftovers of the old double-join bug are cleaned up: a user with
 *            several active tickets in one queue keeps the earliest, the rest
 *            are cancelled; a queue with several "serving" tickets keeps the
 *            latest, the others become served.
 *   Indexes  creates the unique indexes the new code relies on.
 *
 * No-show update (safe to re-run on a database already migrated for A4):
 *   Tickets  `atCounter` set for tickets that are called or serving.
 *   Queues   graceMinutes 5 if missing.
 *   Indexes  drops the old "one serving ticket per queue" index (queue_1),
 *            replaced by one_at_counter_per_queue.
 */
const mongoose = require("mongoose");
const Queue = require("../src/models/Queue");
const Ticket = require("../src/models/Ticket");
const { DB_NAME } = require("../src/config/db");

const ACTIVE = Ticket.ACTIVE_STATUSES;
const AT_COUNTER = Ticket.AT_COUNTER_STATUSES;
const LEGACY_INDEX = "queue_1";
const prefix = (name) => (name && name.length > 0 ? name.charAt(0).toUpperCase() : "Q");

async function migrate({ apply }) {
  const queues = mongoose.connection.collection("queues");
  const tickets = mongoose.connection.collection("tickets");
  const report = {
    queuesUpdated: 0,
    ticketsCreatedFromOldList: 0,
    ticketsNumbered: 0,
    ticketsActiveFlagSet: 0,
    ticketsCounterFlagSet: 0,
    duplicateActiveCancelled: 0,
    extraServingCompleted: 0,
    legacyIndexesDropped: 0,
  };
  const now = new Date();

  for (const q of await queues.find({}).toArray()) {
    const qTickets = await tickets.find({ queue: q._id }).sort({ joinedAt: 1, createdAt: 1, _id: 1 }).toArray();
    const isActive = (t) => ACTIVE.includes(t.status);
    const activeFor = (userId) => qTickets.find((t) => isActive(t) && String(t.user) === String(userId));
    const newTickets = [];

    // 1. People only recorded in the old users[] / nowServing get a ticket.
    for (const entry of q.users || []) {
      if (entry && entry.user && !activeFor(entry.user) && !newTickets.some((t) => String(t.user) === String(entry.user))) {
        newTickets.push({ user: entry.user, status: "waiting", joinedAt: entry.joinedAt || now });
      }
    }
    if (q.nowServing && q.nowServing.user && !qTickets.some((t) => t.status === "serving")) {
      const waiting = activeFor(q.nowServing.user);
      if (waiting) waiting.promoteToServing = true;
      else newTickets.push({ user: q.nowServing.user, status: "serving", joinedAt: q.nowServing.startedAt || now, startedAt: q.nowServing.startedAt, token: q.nowServing.token });
    }

    // 2. Number every ticket in join order (existing numbers are kept).
    let seq = Math.max(0, q.lastSeq || 0, ...qTickets.map((t) => (typeof t.seq === "number" ? t.seq : 0)));
    const updates = [];
    for (const t of qTickets) {
      const set = {};
      if (typeof t.seq !== "number") {
        seq += 1;
        set.seq = seq;
        report.ticketsNumbered += 1;
      }
      if (t.promoteToServing) set.status = "serving";
      const status = set.status || t.status;
      if (t.active !== ACTIVE.includes(status)) {
        set.active = ACTIVE.includes(status);
        report.ticketsActiveFlagSet += 1;
      }
      Object.assign(t, set);
      if (Object.keys(set).length) updates.push({ updateOne: { filter: { _id: t._id }, update: { $set: set } } });
    }
    const inserts = newTickets.map((t) => {
      seq += 1;
      report.ticketsCreatedFromOldList += 1;
      return {
        user: t.user,
        queue: q._id,
        queueName: q.name,
        seq,
        token: t.token || `${prefix(q.name)}-${seq}`,
        status: t.status,
        active: true,
        joinedAt: t.joinedAt,
        startedAt: t.startedAt,
        createdAt: now,
        updatedAt: now,
      };
    });
    const all = [...qTickets, ...inserts];

    // 3. Old double joins: keep each user's earliest active ticket.
    const seen = new Set();
    for (const t of all.filter((x) => x.active).sort((a, b) => a.seq - b.seq)) {
      const key = String(t.user);
      if (!seen.has(key)) {
        seen.add(key);
        continue;
      }
      report.duplicateActiveCancelled += 1;
      t.active = false;
      t.status = "cancelled";
      if (t._id) updates.push({ updateOne: { filter: { _id: t._id }, update: { $set: { status: "cancelled", active: false, completedAt: now } } } });
    }

    // 4. More than one person at the counter: keep the latest, complete the rest.
    const serving = all.filter((t) => AT_COUNTER.includes(t.status)).sort((a, b) => (b.startedAt || b.createdAt || 0) - (a.startedAt || a.createdAt || 0));
    for (const t of serving.slice(1)) {
      report.extraServingCompleted += 1;
      t.status = "served";
      t.active = false;
      if (t._id) updates.push({ updateOne: { filter: { _id: t._id }, update: { $set: { status: "served", active: false, completedAt: now } } } });
    }

    // 5. atCounter follows the final status.
    for (const t of all) {
      const want = AT_COUNTER.includes(t.status);
      if (!t._id) {
        t.atCounter = want; // new ticket, inserted below
      } else if (t.atCounter !== want) {
        report.ticketsCounterFlagSet += 1;
        updates.push({ updateOne: { filter: { _id: t._id }, update: { $set: { atCounter: want } } } });
      }
    }

    // 6. The queue document itself.
    const queueSet = {};
    if (!q.status) queueSet.status = "open";
    if (typeof q.graceMinutes !== "number") queueSet.graceMinutes = 5;
    if (q.lastSeq !== seq) queueSet.lastSeq = seq;
    const queueUnset = {};
    if ("users" in q) queueUnset.users = "";
    if ("nowServing" in q) queueUnset.nowServing = "";
    const queueChanged = Object.keys(queueSet).length || Object.keys(queueUnset).length;
    if (queueChanged) report.queuesUpdated += 1;

    if (apply) {
      if (inserts.length) await tickets.insertMany(inserts);
      if (updates.length) await tickets.bulkWrite(updates, { ordered: true });
      if (queueChanged) {
        const update = {};
        if (Object.keys(queueSet).length) update.$set = queueSet;
        if (Object.keys(queueUnset).length) update.$unset = queueUnset;
        await queues.updateOne({ _id: q._id }, update);
      }
    }
  }

  const legacy = (await tickets.indexes().catch(() => [])).find((i) => i.name === LEGACY_INDEX);
  if (legacy) {
    report.legacyIndexesDropped = 1;
    if (apply) await tickets.dropIndex(LEGACY_INDEX);
  }

  if (apply) {
    await Ticket.createIndexes();
    await Queue.createIndexes();
  }
  return report;
}

async function main() {
  require("dotenv").config({ quiet: true });
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI is not set");
  const apply = process.argv.includes("--apply");

  await mongoose.connect(process.env.MONGO_URI, { dbName: DB_NAME, autoIndex: false });
  try {
    const report = await migrate({ apply });
    console.log(`${apply ? "Migrated" : "Dry run (nothing written), would change"} "${DB_NAME}":`);
    console.table(report);
    if (!apply) console.log("Re-run with --apply to write these changes.");
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  });
}

module.exports = { migrate };
