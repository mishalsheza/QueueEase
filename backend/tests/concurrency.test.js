// A4: concurrent requests can't create duplicate tokens, double joins, two
// people at the counter, or 5xx errors. Requests are fired together with
// Promise.all against the in-process app; bench/concurrency.js runs the same
// scenarios at larger scale over real HTTP.
const request = require("supertest");
const app = require("../src/app");
const mongoose = require("mongoose");
const Ticket = require("../src/models/Ticket");
const db = require("./helpers/db");
const { createUser } = require("./helpers/factories");

beforeAll(db.connect);
afterEach(db.clear);
afterAll(db.close);

const post = (actor, url) => request(app).post(url).set("Authorization", actor.auth);
const users = (n) => Promise.all(Array.from({ length: n }, () => createUser()));

let admin, q;
beforeEach(async () => {
  admin = await createUser({ role: "admin" });
  q = (await post(admin, "/api/queues").send({ name: "Lab" })).body;
});

test("30 simultaneous joins -> 30 tickets with 30 different tokens, no errors", async () => {
  const us = await users(30);
  const res = await Promise.all(us.map((u) => post(u, `/api/queues/${q._id}/join`)));
  expect(res.map((r) => r.status)).toEqual(Array(30).fill(200));

  const tickets = await Ticket.find({ queue: q._id });
  expect(tickets).toHaveLength(30);
  expect(new Set(tickets.map((t) => t.token)).size).toBe(30);
});

test("one user tapping Join 10 times at once gets exactly one ticket", async () => {
  const [u] = await users(1);
  const res = await Promise.all(Array.from({ length: 10 }, () => post(u, `/api/queues/${q._id}/join`)));
  expect(res.every((r) => r.status === 200)).toBe(true);
  expect(await Ticket.countDocuments({ queue: q._id, user: u.user._id, active: true })).toBe(1);
});

test("join/leave storm: no 5xx, at most one active ticket per user, list matches tickets", async () => {
  const us = await users(15);
  const res = await Promise.all(
    us.flatMap((u) => ["join", "leave", "join", "leave"].map((a) => post(u, `/api/queues/${q._id}/${a}`)))
  );
  expect(res.filter((r) => r.status >= 500)).toHaveLength(0);

  const active = await Ticket.find({ queue: q._id, active: true });
  const perUser = active.map((t) => String(t.user));
  expect(new Set(perUser).size).toBe(perUser.length);

  const list = (await request(app).get("/api/queues").set("Authorization", admin.auth)).body[0];
  expect(list.users.map((x) => x.user).sort()).toEqual(active.filter((t) => t.status === "waiting").map((t) => String(t.user)).sort());
});

test("two call-nexts at the same moment never put two people at the counter or lose anyone", async () => {
  const us = await users(5);
  for (const u of us) await post(u, `/api/queues/${q._id}/join`);

  const res = await Promise.all([post(admin, `/api/queues/${q._id}/call-next`), post(admin, `/api/queues/${q._id}/call-next`)]);
  expect(res.filter((r) => r.status >= 500)).toHaveLength(0);
  expect(res.every((r) => r.status === 200 || r.status === 409)).toBe(true);

  expect(await Ticket.countDocuments({ queue: q._id, atCounter: true })).toBe(1);
  const counts = await Ticket.aggregate([{ $match: { queue: new mongoose.Types.ObjectId(q._id) } }, { $group: { _id: "$status", n: { $sum: 1 } } }]);
  const total = counts.reduce((s, c) => s + c.n, 0);
  expect(total).toBe(5); // every ticket is still accounted for
});

test("joins racing a close leave no waiting tickets behind", async () => {
  const us = await users(20);
  const res = await Promise.all([
    ...us.map((u) => post(u, `/api/queues/${q._id}/join`)),
    post(admin, `/api/queues/${q._id}/close`),
  ]);
  expect(res.filter((r) => r.status >= 500)).toHaveLength(0);
  expect(await Ticket.countDocuments({ queue: q._id, status: "waiting" })).toBe(0);
});

test("the indexes that enforce this exist", async () => {
  const idx = await Ticket.collection.indexes();
  const unique = idx.filter((i) => i.unique).map((i) => JSON.stringify(i.key));
  expect(unique).toEqual(expect.arrayContaining(['{"queue":1,"seq":1}', '{"queue":1,"user":1}', '{"queue":1}']));
});
