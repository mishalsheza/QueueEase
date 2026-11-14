// A4 migration: old-format data (Queue.users / nowServing, unnumbered tickets,
// double-join leftovers) is moved to the Ticket-first model and works with the
// new API afterwards.
const request = require("supertest");
const mongoose = require("mongoose");
const app = require("../src/app");
const Queue = require("../src/models/Queue");
const Ticket = require("../src/models/Ticket");
const { migrate } = require("../scripts/migrate_queue_model");
const db = require("./helpers/db");
const { createUser } = require("./helpers/factories");

beforeAll(db.connect);
afterEach(db.clear);
afterAll(db.close);

const t0 = new Date("2026-01-01T10:00:00Z");
const at = (min) => new Date(t0.getTime() + min * 60000);

/** Writes data the way the pre-A4 code stored it, bypassing the new schema. */
async function seedOldFormat() {
  const admin = await createUser({ role: "admin" });
  const [u1, u2, u3, u4] = await Promise.all([createUser(), createUser(), createUser(), createUser()]);
  // Old data can violate the new unique indexes, as it would in a real DB.
  await Ticket.collection.dropIndexes();

  const qid = new mongoose.Types.ObjectId();
  await mongoose.connection.collection("queues").insertOne({
    _id: qid, name: "Dental", admin: admin.user._id, type: "General Checkup", section: "A",
    servedToday: 1, avgProcessTime: 15,
    users: [
      { user: u2.user._id, joinedAt: at(2) },
      { user: u3.user._id, joinedAt: at(3) },
      { user: u4.user._id, joinedAt: at(4) }, // in the old list but has no ticket
    ],
    nowServing: { user: u1.user._id, token: "D-1", startedAt: at(5) },
  });
  const old = (user, token, status, min) => ({
    user: user.user._id, queue: qid, queueName: "Dental", token, status, joinedAt: at(min), createdAt: at(min),
  });
  await mongoose.connection.collection("tickets").insertMany([
    old(u1, "D-1", "serving", 1),
    old(u2, "D-2", "waiting", 2),
    old(u3, "D-2", "waiting", 3), // the old duplicate-token bug
    old(u3, "D-3", "waiting", 3.5), // the old double-join bug
    old(u2, "D-0", "served", 0),
  ]);
  return { admin, u1, u2, u3, u4, qid };
}

test("dry run reports the changes and writes nothing", async () => {
  const { qid } = await seedOldFormat();
  const report = await migrate({ apply: false });
  expect(report).toMatchObject({ queuesUpdated: 1, ticketsCreatedFromOldList: 1, duplicateActiveCancelled: 1 });
  expect(await Ticket.countDocuments({ seq: { $exists: true } })).toBe(0);
  expect((await mongoose.connection.collection("queues").findOne({ _id: qid })).users).toHaveLength(3);
});

test("--apply migrates old data so the new API works on it", async () => {
  const { admin, u1, u2, u3, u4, qid } = await seedOldFormat();
  const report = await migrate({ apply: true });
  expect(report).toEqual({
    queuesUpdated: 1,
    ticketsCreatedFromOldList: 1,
    ticketsNumbered: 5,
    ticketsActiveFlagSet: 5,
    ticketsCounterFlagSet: 5, // every existing ticket: u1 serving -> true, the rest false
    duplicateActiveCancelled: 1,
    extraServingCompleted: 0,
    legacyIndexesDropped: 0,
  });

  const raw = await mongoose.connection.collection("queues").findOne({ _id: qid });
  expect(raw).toMatchObject({ status: "open", lastSeq: 6, graceMinutes: 5 });
  expect(raw).not.toHaveProperty("users");
  expect(raw).not.toHaveProperty("nowServing");

  // Waiting order is preserved: u2, u3 (earliest ticket kept), then u4.
  const live = (await request(app).get("/api/queues").set("Authorization", admin.auth)).body[0];
  expect(live.nowServing.user).toBe(u1.user._id.toString());
  expect(live.users.map((x) => x.user)).toEqual([u2, u3, u4].map((u) => u.user._id.toString()));
  expect(await Ticket.countDocuments({ user: u3.user._id, active: true })).toBe(1);

  // New joins get fresh numbers after the old ones; call-next continues normally.
  const u5 = await createUser();
  expect((await request(app).post(`/api/queues/${qid}/join`).set("Authorization", u5.auth)).status).toBe(200);
  expect((await Ticket.findOne({ user: u5.user._id })).token).toBe("D-7");
  const next = await request(app).post(`/api/queues/${qid}/call-next`).set("Authorization", admin.auth);
  expect(next.body.queue.nowServing.user).toBe(u2.user._id.toString());

  // The unique indexes are in place.
  const unique = (await Ticket.collection.indexes()).filter((i) => i.unique).map((i) => JSON.stringify(i.key));
  expect(unique).toEqual(expect.arrayContaining(['{"queue":1,"seq":1}', '{"queue":1,"user":1}', '{"queue":1}']));
});

test("no-show update on a database already migrated for A4: flags set, old index replaced", async () => {
  const admin = await createUser({ role: "admin" });
  const u = await createUser();
  await Ticket.collection.dropIndexes();
  // The A4 index, as it exists in a database migrated before this change.
  await Ticket.collection.createIndex({ queue: 1 }, { unique: true, name: "queue_1", partialFilterExpression: { status: "serving" } });
  const qid = new mongoose.Types.ObjectId();
  await mongoose.connection.collection("queues").insertOne({ _id: qid, name: "Lab", admin: admin.user._id, status: "open", lastSeq: 1, servedToday: 0 });
  await mongoose.connection.collection("tickets").insertOne({
    user: u.user._id, queue: qid, queueName: "Lab", seq: 1, token: "L-1", status: "serving", active: true, startedAt: at(1), createdAt: at(1),
  });

  const report = await migrate({ apply: true });
  expect(report).toMatchObject({ ticketsCounterFlagSet: 1, legacyIndexesDropped: 1, queuesUpdated: 1, ticketsNumbered: 0 });

  const names = (await Ticket.collection.indexes()).map((i) => i.name);
  expect(names).not.toContain("queue_1");
  expect(names).toContain("one_at_counter_per_queue");

  // The old "serving" ticket is the person at the counter and can be marked a no-show.
  const live = (await request(app).get("/api/queues").set("Authorization", admin.auth)).body[0];
  expect(live).toMatchObject({ graceMinutes: 5, nowServing: { token: "L-1", status: "serving" } });
  const ns = await request(app).post(`/api/queues/${qid}/no-show`).set("Authorization", admin.auth);
  expect(ns.status).toBe(200);
  expect((await Ticket.findOne({ user: u.user._id })).status).toBe("no_show");
});

test("running it twice changes nothing the second time", async () => {
  await seedOldFormat();
  await migrate({ apply: true });
  expect(await migrate({ apply: true })).toEqual({
    queuesUpdated: 0, ticketsCreatedFromOldList: 0, ticketsNumbered: 0,
    ticketsActiveFlagSet: 0, ticketsCounterFlagSet: 0, duplicateActiveCancelled: 0,
    extraServingCompleted: 0, legacyIndexesDropped: 0,
  });
});

test("several 'serving' tickets in one queue: the latest stays, the rest are completed", async () => {
  const admin = await createUser({ role: "admin" });
  const [a, b] = await Promise.all([createUser(), createUser()]);
  await Ticket.collection.dropIndexes();
  const q = await Queue.create({ name: "Lab", admin: admin.user._id });
  await mongoose.connection.collection("tickets").insertMany([
    { user: a.user._id, queue: q._id, queueName: "Lab", token: "L-1", status: "serving", createdAt: at(1), startedAt: at(1) },
    { user: b.user._id, queue: q._id, queueName: "Lab", token: "L-2", status: "serving", createdAt: at(2), startedAt: at(2) },
  ]);
  const report = await migrate({ apply: true });
  expect(report.extraServingCompleted).toBe(1);
  expect((await Ticket.findOne({ user: a.user._id })).status).toBe("served");
  expect((await Ticket.findOne({ user: b.user._id })).status).toBe("serving");
});
