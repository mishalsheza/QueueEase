// No-show: "called" and "no_show" ticket states, an owner-only endpoint that
// races safely with serve, reports that count no-shows separately, and a
// per-queue grace period for the "overdue" hint.
const request = require("supertest");
const mongoose = require("mongoose");
const app = require("../src/app");
const Queue = require("../src/models/Queue");
const Ticket = require("../src/models/Ticket");
const db = require("./helpers/db");
const { createUser } = require("./helpers/factories");

beforeAll(db.connect);
afterEach(db.clear);
afterAll(db.close);

const as = (actor) => ({
  get: (url) => request(app).get(url).set("Authorization", actor.auth),
  post: (url, body) => request(app).post(url).set("Authorization", actor.auth).send(body),
  patch: (url, body) => request(app).patch(url).set("Authorization", actor.auth).send(body),
});

let admin, other, u1, u2, q;
const url = (p) => `/api/queues/${q._id}/${p}`;
beforeEach(async () => {
  admin = await createUser({ role: "admin" });
  other = await createUser({ role: "admin" });
  [u1, u2] = await Promise.all([createUser(), createUser()]);
  q = (await as(admin).post("/api/queues", { name: "Xray" })).body;
  await as(u1).post(url("join"));
  await as(u2).post(url("join"));
});
const callNext = async () => (await as(admin).post(url("call-next"))).body.queue;

describe("called state", () => {
  test("call-next marks the ticket called with calledAt; the queue exposes it", async () => {
    const before = Date.now();
    const live = await callNext();
    const t = await Ticket.findOne({ user: u1.user._id });
    expect(t).toMatchObject({ status: "called", active: true, atCounter: true });
    expect(t.calledAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(live.graceMinutes).toBe(5);
    expect(live.nowServing).toMatchObject({ ticketId: t._id.toString(), token: "X-1", status: "called" });
    expect(new Date(live.nowServing.calledAt).getTime()).toBe(t.calledAt.getTime());
  });

  test("the called user sees status called with position 0", async () => {
    await callNext();
    const [mine] = (await as(u1).get("/api/queues/my-status")).body;
    expect(mine).toMatchObject({ status: "called", position: 0, token: "X-1" });
  });
});

describe("marking a no-show", () => {
  test("owner marks the called person: ticket leaves the queue as no_show", async () => {
    const live = await callNext();
    const res = await as(admin).post(url("no-show"), { ticketId: live.nowServing.ticketId });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ message: "Marked as no-show", token: "X-1" });
    expect(res.body.queue.nowServing).toBeUndefined();
    expect(res.body.queue.users.map((x) => x.user)).toEqual([u2.user._id.toString()]);

    const t = await Ticket.findOne({ user: u1.user._id });
    expect(t).toMatchObject({ status: "no_show", active: false, atCounter: false });
    expect(t.completedAt).toBeInstanceOf(Date);
    expect((await Queue.findById(q._id)).servedToday).toBe(0); // not counted as served
  });

  test("after a no-show, call-next calls the next person and marks nobody served", async () => {
    await callNext();
    await as(admin).post(url("no-show"));
    const live = await callNext();
    expect(live.nowServing.token).toBe("X-2");
    expect(await Ticket.countDocuments({ status: "served" })).toBe(0);
    expect((await Ticket.findOne({ user: u1.user._id })).status).toBe("no_show");
  });

  test("the user sees it as no_show in history and recent status, and can join again", async () => {
    await callNext();
    await as(admin).post(url("no-show"));
    const history = (await as(u1).get("/api/queues/my-history")).body;
    expect(history).toEqual([expect.objectContaining({ token: "X-1", status: "no_show" })]);
    const status = (await as(u1).get("/api/queues/my-status")).body;
    expect(status).toEqual([expect.objectContaining({ status: "no_show", token: "X-1" })]);

    expect((await as(u1).post(url("join"))).status).toBe(200);
    expect((await Ticket.findOne({ user: u1.user._id, active: true })).token).toBe("X-3");
  });

  test("works on a legacy 'serving' ticket too", async () => {
    await callNext();
    await Ticket.updateOne({ user: u1.user._id }, { $set: { status: "serving" } });
    expect((await as(admin).post(url("no-show"))).status).toBe(200);
    expect((await Ticket.findOne({ user: u1.user._id })).status).toBe("no_show");
  });

  test("nobody at the counter -> 400; a ticket that already left the counter -> 409", async () => {
    expect((await as(admin).post(url("no-show"))).status).toBe(400);
    const live = await callNext();
    await as(admin).post(url("serve"));
    const stale = await as(admin).post(url("no-show"), { ticketId: live.nowServing.ticketId });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe("CONFLICT");
    expect((await Ticket.findOne({ user: u1.user._id })).status).toBe("served");
  });

  test("ticketId for someone no longer at the counter never hits the next person", async () => {
    const first = await callNext();
    await callNext(); // u1 served, u2 called
    const res = await as(admin).post(url("no-show"), { ticketId: first.nowServing.ticketId });
    expect(res.status).toBe(409);
    expect((await Ticket.findOne({ user: u2.user._id })).status).toBe("called");
  });

  test.each([["not-an-id"], [123], [{ $ne: null }]])("invalid ticketId %p -> 400", async (ticketId) => {
    await callNext();
    expect((await as(admin).post(url("no-show"), { ticketId })).status).toBe(400);
    expect((await Ticket.findOne({ user: u1.user._id })).status).toBe("called");
  });
});

describe("who may mark a no-show", () => {
  beforeEach(callNext);

  test("another admin -> 403, ticket unchanged", async () => {
    const res = await as(other).post(url("no-show"));
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ message: "You can only manage your own queues", code: "FORBIDDEN" });
    expect((await Ticket.findOne({ user: u1.user._id })).status).toBe("called");
  });

  test("a user (even the called one) -> 403, ticket unchanged", async () => {
    for (const u of [u1, u2]) {
      const res = await as(u).post(url("no-show"));
      expect(res.status).toBe(403);
      expect(res.body.message).toBe("Admin access only");
    }
    expect((await Ticket.findOne({ user: u1.user._id })).status).toBe("called");
  });
});

describe("no-show vs serve at the same moment", () => {
  test("exactly one wins, the other gets 409 (20 races)", async () => {
    const outcomes = { no_show: 0, served: 0 };
    for (let i = 0; i < 20; i += 1) {
      const qq = (await as(admin).post("/api/queues", { name: `Race ${i}` })).body;
      const u = await createUser();
      await as(u).post(`/api/queues/${qq._id}/join`);
      const live = (await as(admin).post(`/api/queues/${qq._id}/call-next`)).body.queue;
      const body = { ticketId: live.nowServing.ticketId };

      const [ns, sv] = await Promise.all([
        as(admin).post(`/api/queues/${qq._id}/no-show`, body),
        as(admin).post(`/api/queues/${qq._id}/serve`, body),
      ]);
      expect([ns.status, sv.status].sort()).toEqual([200, 409]);

      const t = await Ticket.findOne({ queue: qq._id });
      const winner = ns.status === 200 ? "no_show" : "served";
      expect(t.status).toBe(winner);
      expect((await Queue.findById(qq._id)).servedToday).toBe(winner === "served" ? 1 : 0);
      outcomes[winner] += 1;
    }
    expect(outcomes.no_show + outcomes.served).toBe(20);
  });

  test("without ticketId there is still exactly one winner", async () => {
    await callNext();
    const res = await Promise.all([as(admin).post(url("no-show")), as(admin).post(url("serve"))]);
    expect(res.filter((r) => r.status === 200)).toHaveLength(1);
    expect(res.filter((r) => r.status >= 500)).toHaveLength(0);
    expect(await Ticket.countDocuments({ user: u1.user._id, status: { $in: ["served", "no_show"] } })).toBe(1);
  });
});

describe("reports count no-shows separately", () => {
  beforeEach(async () => {
    await callNext(); // u1 called
    await as(admin).post(url("no-show")); // u1 no-show
    await callNext(); // u2 called
    await as(admin).post(url("serve")); // u2 served
    const u3 = await createUser();
    await as(u3).post(url("join")); // u3 waiting
  });

  test("GET /admin/stats: totals and per queue, no-shows on their own", async () => {
    const res = await as(admin).get("/api/queues/admin/stats");
    expect(res.status).toBe(200);
    expect(res.body.totals).toEqual({ waiting: 1, called: 0, served: 1, cancelled: 0, noShow: 1 });
    expect(res.body.queues).toEqual([
      expect.objectContaining({ name: "Xray", status: "open", waiting: 1, served: 1, cancelled: 0, noShow: 1 }),
    ]);
  });

  test("stats are scoped to the admin's queues and users get 403", async () => {
    expect((await as(other).get("/api/queues/admin/stats")).body.totals.noShow).toBe(0);
    expect((await as(u1).get("/api/queues/admin/stats")).status).toBe(403);
  });

  test("users-report lists the no-show; completed-report (served only) does not", async () => {
    const report = (await as(admin).get("/api/queues/admin/users-report")).body;
    expect(report.map((t) => t.status).sort()).toEqual(["no_show", "served", "waiting"]);
    const completed = (await as(admin).get("/api/queues/admin/completed-report")).body;
    expect(completed.map((t) => t.token)).toEqual(["X-2"]);
  });

  test("closed queues keep their no-shows in stats", async () => {
    await as(admin).post(url("close"));
    expect((await as(admin).get("/api/queues/admin/stats")).body.totals).toMatchObject({ noShow: 1, served: 1, cancelled: 1, waiting: 0 });
  });
});

describe("grace period", () => {
  test("set at creation and changed later; only the owner may change it", async () => {
    const created = (await as(admin).post("/api/queues", { name: "Slow", graceMinutes: 10 })).body;
    expect(created.graceMinutes).toBe(10);

    const res = await as(admin).patch(`/api/queues/${created._id}/settings`, { graceMinutes: 15 });
    expect(res.status).toBe(200);
    expect(res.body.queue.graceMinutes).toBe(15);
    expect((await as(other).patch(`/api/queues/${created._id}/settings`, { graceMinutes: 1 })).status).toBe(403);
    expect((await Queue.findById(created._id)).graceMinutes).toBe(15);
  });

  test.each([[0], [121], ["5"], [2.5], [undefined]])("graceMinutes %p -> 400", async (graceMinutes) => {
    expect((await as(admin).patch(url("settings"), { graceMinutes })).status).toBe(400);
    expect((await Queue.findById(q._id)).graceMinutes).toBe(5);
  });

  test.each([[0], [121], [2.5], ["abc"]])("graceMinutes %p at creation -> 400, no queue created", async (graceMinutes) => {
    const res = await as(admin).post("/api/queues", { name: "Bad", graceMinutes });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
    expect(await Queue.countDocuments({ name: "Bad" })).toBe(0);
  });

  test.each([[1], [120]])("graceMinutes %p at creation (range edges) is accepted", async (graceMinutes) => {
    expect((await as(admin).post("/api/queues", { name: "Edge", graceMinutes })).body.graceMinutes).toBe(graceMinutes);
  });

  test("no graceMinutes at creation -> 5", async () => {
    expect((await as(admin).post("/api/queues", { name: "Default" })).body.graceMinutes).toBe(5);
  });

  test("being overdue never marks a no-show by itself", async () => {
    await callNext();
    const long = new Date(Date.now() - 60 * 60 * 1000);
    await Ticket.updateOne({ user: u1.user._id }, { $set: { calledAt: long } });
    const [live] = (await as(admin).get("/api/queues")).body;
    expect(live.nowServing.status).toBe("called");
    expect((await Ticket.findOne({ user: u1.user._id })).status).toBe("called");
  });
});

test("ids are real ObjectIds in nowServing", async () => {
  const live = await callNext();
  expect(mongoose.isValidObjectId(live.nowServing.ticketId)).toBe(true);
});
