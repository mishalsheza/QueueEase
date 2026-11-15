// A5: sockets require a valid login, clients only join rooms they are
// entitled to, updates are small, and "ticket:called" reaches only the person
// called. Runs the real app + Socket.io on a random port with socket.io-client.
const http = require("http");
const request = require("supertest");
const { io: connect } = require("socket.io-client");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const app = require("../src/app");
const User = require("../src/models/User");
const { attachSocket } = require("../src/realtime/socket");
const db = require("./helpers/db");
const { createUser } = require("./helpers/factories");

let server, io, url;
const sockets = [];

beforeAll(async () => {
  await db.connect();
  server = http.createServer(app);
  io = attachSocket(server);
  app.set("io", io);
  await new Promise((r) => server.listen(0, r));
  url = `http://127.0.0.1:${server.address().port}`;
});
afterEach(async () => {
  sockets.splice(0).forEach((s) => s.disconnect());
  await db.clear();
});
afterAll(async () => {
  app.set("io", undefined);
  io.close();
  await new Promise((r) => server.close(r));
  await db.close();
});

/** Connects with a token (or none) and resolves once connected or refused. */
function open(token) {
  const s = connect(url, { auth: token === undefined ? {} : { token }, transports: ["websocket"], forceNew: true, reconnection: false });
  sockets.push(s);
  s.received = [];
  s.onAny((event, payload) => s.received.push({ event, payload }));
  return new Promise((resolve) => {
    s.on("connect", () => resolve({ s, ok: true }));
    s.on("connect_error", (err) => resolve({ s, ok: false, error: err.message }));
  });
}
const connected = async (actor) => (await open(actor.token)).s;
const subscribe = (s, queueId) => s.timeout(2000).emitWithAck("queue:subscribe", queueId);
/** Waits a moment for in-flight events, then returns what arrived. */
const settle = () => new Promise((r) => setTimeout(r, 150));
const events = (s, name) => s.received.filter((e) => e.event === name).map((e) => e.payload);

const api = (actor) => ({
  post: (path, body) => request(app).post(`/api/queues${path}`).set("Authorization", actor.auth).send(body),
  patch: (path, body) => request(app).patch(`/api/queues${path}`).set("Authorization", actor.auth).send(body),
});

let admin, otherAdmin, u1, u2, q;
beforeEach(async () => {
  admin = await createUser({ role: "admin" });
  otherAdmin = await createUser({ role: "admin" });
  [u1, u2] = await Promise.all([createUser(), createUser()]);
  q = (await api(admin).post("", { name: "Optics" })).body;
});

describe("connecting requires a valid login", () => {
  test("no token -> refused with UNAUTHORIZED", async () => {
    expect(await open(undefined)).toMatchObject({ ok: false, error: "UNAUTHORIZED" });
  });

  test.each([
    ["garbage", () => "not-a-jwt"],
    ["wrong secret", () => jwt.sign({ id: new mongoose.Types.ObjectId() }, "other-secret")],
    ["expired", () => jwt.sign({ id: u1.user._id }, process.env.JWT_SECRET, { expiresIn: -10 })],
    ["non-string", () => 12345],
  ])("%s token -> refused", async (_label, make) => {
    expect(await open(make())).toMatchObject({ ok: false, error: "UNAUTHORIZED" });
  });

  test("token of a deleted account -> refused", async () => {
    await User.deleteOne({ _id: u2.user._id });
    expect(await open(u2.token)).toMatchObject({ ok: false, error: "UNAUTHORIZED" });
  });

  test("valid user and admin tokens connect", async () => {
    expect((await open(u1.token)).ok).toBe(true);
    expect((await open(admin.token)).ok).toBe(true);
  });

  test("token in the query string is ignored (not accepted, not logged)", async () => {
    const s = connect(`${url}?token=${u1.token}`, { transports: ["websocket"], forceNew: true, reconnection: false });
    sockets.push(s);
    const err = await new Promise((r) => s.on("connect_error", (e) => r(e.message)));
    expect(err).toBe("UNAUTHORIZED");
  });
});

describe("rooms are entitlement-checked", () => {
  test("admin may watch own queue, not another admin's", async () => {
    expect(await subscribe(await connected(admin), q._id)).toEqual({ ok: true });
    expect(await subscribe(await connected(otherAdmin), q._id)).toEqual({ ok: false, error: "FORBIDDEN" });
  });

  test("users may watch open or paused queues, not closed ones", async () => {
    const s = await connected(u1);
    expect(await subscribe(s, q._id)).toEqual({ ok: true });
    await api(admin).patch(`/${q._id}/status`, { status: "paused" });
    expect(await subscribe(s, q._id)).toEqual({ ok: true });
    await api(admin).post(`/${q._id}/close`);
    expect(await subscribe(s, q._id)).toEqual({ ok: false, error: "FORBIDDEN" });
  });

  test.each([["not-an-id"], [{ $ne: null }], [123], ["user:abc"]])("subscribe(%p) -> INVALID_ID", async (bad) => {
    expect(await subscribe(await connected(u1), bad)).toEqual({ ok: false, error: "INVALID_ID" });
  });

  test("unknown queue -> NOT_FOUND", async () => {
    expect(await subscribe(await connected(u1), new mongoose.Types.ObjectId().toString())).toEqual({ ok: false, error: "NOT_FOUND" });
  });

  test("the old raw 'joinQueue' room event no longer puts anyone in a room", async () => {
    const s = await connected(u2);
    s.emit("joinQueue", q._id);
    s.emit("joinQueue", `user:${u1.user._id}`);
    await settle();
    await api(u1).post(`/${q._id}/join`);
    await api(admin).post(`/${q._id}/call-next`);
    await settle();
    expect(s.received.filter((e) => e.event !== "queues:changed")).toEqual([]);
  });

  test("a refused subscription receives nothing from that queue", async () => {
    const s = await connected(otherAdmin);
    await subscribe(s, q._id);
    await api(u1).post(`/${q._id}/join`);
    await settle();
    expect(events(s, "queue:update")).toEqual([]);
  });
});

describe("small updates instead of whole queue documents", () => {
  test("queue watchers get { queueId, reason, status, waitingCount, nowServing, nextToken } only", async () => {
    const watcher = await connected(u2);
    await subscribe(watcher, q._id);
    await api(u1).post(`/${q._id}/join`);
    await settle();

    const [update] = events(watcher, "queue:update");
    expect(update).toEqual({ queueId: q._id, reason: "joined", status: "open", waitingCount: 1, nowServing: null, nextToken: "O-1" });
    expect(JSON.stringify(update)).not.toContain(u1.user._id.toString()); // no user ids
  });

  test("every action publishes with its reason", async () => {
    const watcher = await connected(u2);
    await subscribe(watcher, q._id);
    await api(u1).post(`/${q._id}/join`);
    await api(u1).post(`/${q._id}/leave`);
    await api(u1).post(`/${q._id}/join`);
    await api(admin).post(`/${q._id}/call-next`);
    await api(admin).post(`/${q._id}/serve`);
    await api(u1).post(`/${q._id}/join`);
    await api(admin).post(`/${q._id}/call-next`);
    await api(admin).post(`/${q._id}/no-show`);
    await api(admin).patch(`/${q._id}/status`, { status: "paused" });
    await api(admin).patch(`/${q._id}/status`, { status: "open" });
    await api(admin).patch(`/${q._id}/settings`, { graceMinutes: 9 });
    await api(admin).post(`/${q._id}/close`);
    await settle();
    expect(events(watcher, "queue:update").map((e) => e.reason)).toEqual([
      "joined", "left", "joined", "called", "served", "joined", "called", "no_show", "paused", "resumed", "settings", "closed",
    ]);
    expect(events(watcher, "queue:update").at(-1)).toMatchObject({ status: "closed", waitingCount: 0, nowServing: null });
  });

  test("an idempotent re-join publishes nothing", async () => {
    const watcher = await connected(u2);
    await subscribe(watcher, q._id);
    await api(u1).post(`/${q._id}/join`);
    await api(u1).post(`/${q._id}/join`);
    await settle();
    expect(events(watcher, "queue:update")).toHaveLength(1);
  });

  test("the owning admin gets updates for all their queues without subscribing; other admins get none", async () => {
    const own = await connected(admin);
    const other = await connected(otherAdmin);
    await api(u1).post(`/${q._id}/join`);
    const q2 = (await api(admin).post("", { name: "Lab" })).body;
    await api(u2).post(`/${q2._id}/join`);
    await settle();
    expect(events(own, "queue:update").map((e) => [e.queueId, e.reason])).toEqual([
      [q._id, "joined"], [q2._id, "created"], [q2._id, "joined"],
    ]);
    expect(events(other, "queue:update")).toEqual([]);
  });

  test("an admin who also subscribed to their queue gets each update once", async () => {
    const own = await connected(admin);
    await subscribe(own, q._id);
    await api(u1).post(`/${q._id}/join`);
    await settle();
    expect(events(own, "queue:update")).toHaveLength(1);
  });

  test("users hear about queue list changes (created / paused / resumed / closed), admins don't", async () => {
    const user = await connected(u1);
    const otherA = await connected(otherAdmin);
    const q2 = (await api(admin).post("", { name: "Lab" })).body;
    await api(admin).patch(`/${q2._id}/status`, { status: "paused" });
    await api(admin).patch(`/${q2._id}/status`, { status: "open" });
    await api(admin).post(`/${q2._id}/close`);
    await settle();
    expect(events(user, "queues:changed")).toEqual([
      { queueId: q2._id, reason: "created" }, { queueId: q2._id, reason: "paused" },
      { queueId: q2._id, reason: "resumed" }, { queueId: q2._id, reason: "closed" },
    ]);
    expect(events(otherA, "queues:changed")).toEqual([]);
  });

  test("unsubscribe stops updates", async () => {
    const s = await connected(u2);
    await subscribe(s, q._id);
    await s.timeout(2000).emitWithAck("queue:unsubscribe", q._id);
    await api(u1).post(`/${q._id}/join`);
    await settle();
    expect(events(s, "queue:update")).toEqual([]);
  });
});

describe("'you're being called' goes only to the person called", () => {
  test("call-next notifies the called user on every device, nobody else", async () => {
    const phone = await connected(u1);
    const laptop = await connected(u1);
    const otherUser = await connected(u2);
    const ownAdmin = await connected(admin);
    await subscribe(otherUser, q._id); // even watching the same queue

    await api(u1).post(`/${q._id}/join`);
    await api(u2).post(`/${q._id}/join`);
    const res = await api(admin).post(`/${q._id}/call-next`);
    await settle();

    const expected = { queueId: q._id, queueName: "Optics", token: "O-1", calledAt: expect.any(String) };
    expect(events(phone, "ticket:called")).toEqual([expected]);
    expect(events(laptop, "ticket:called")).toEqual([expected]);
    expect(new Date(events(phone, "ticket:called")[0].calledAt).getTime()).toBe(new Date(res.body.queue.nowServing.calledAt).getTime());
    expect(events(otherUser, "ticket:called")).toEqual([]);
    expect(events(ownAdmin, "ticket:called")).toEqual([]);
  });

  test("the next call-next notifies the next person", async () => {
    const s1 = await connected(u1);
    const s2 = await connected(u2);
    await api(u1).post(`/${q._id}/join`);
    await api(u2).post(`/${q._id}/join`);
    await api(admin).post(`/${q._id}/call-next`);
    await api(admin).post(`/${q._id}/call-next`);
    await settle();
    expect(events(s1, "ticket:called").map((e) => e.token)).toEqual(["O-1"]);
    expect(events(s2, "ticket:called").map((e) => e.token)).toEqual(["O-2"]);
  });

  test("a failed call-next (empty queue) notifies nobody", async () => {
    const s1 = await connected(u1);
    expect((await api(admin).post(`/${q._id}/call-next`)).status).toBe(400);
    await settle();
    expect(events(s1, "ticket:called")).toEqual([]);
  });
});

test("the old broadcast event 'queueUpdated' is gone", async () => {
  const s = await connected(u2);
  await subscribe(s, q._id);
  await api(u1).post(`/${q._id}/join`);
  await api(admin).post(`/${q._id}/call-next`);
  await settle();
  expect(events(s, "queueUpdated")).toEqual([]);
});
