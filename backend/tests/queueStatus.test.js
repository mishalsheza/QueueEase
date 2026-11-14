// A4: queue status (open / paused / closed), close replacing delete, and the
// Ticket-first model's tokens and positions.
const request = require("supertest");
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
  del: (url) => request(app).delete(url).set("Authorization", actor.auth),
});

let admin, u1, u2, u3, q;
beforeEach(async () => {
  admin = await createUser({ role: "admin" });
  [u1, u2, u3] = await Promise.all([createUser(), createUser(), createUser()]);
  q = (await as(admin).post("/api/queues", { name: "Dental" })).body;
});
const join = (u) => as(u).post(`/api/queues/${q._id}/join`);
const setStatus = (status) => as(admin).patch(`/api/queues/${q._id}/status`, { status });

describe("new queues", () => {
  test("start open, with an empty live state", () => {
    expect(q).toMatchObject({ status: "open", users: [], waitingCount: 0, nextToken: null });
  });
});

describe("pause / resume", () => {
  test("paused queue rejects joins with 409 but keeps its waiting list", async () => {
    await join(u1);
    await join(u2);

    const paused = await setStatus("paused");
    expect(paused.status).toBe(200);
    expect(paused.body.queue.status).toBe("paused");

    const res = await join(u3);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("QUEUE_PAUSED");
    expect(await Ticket.countDocuments({ user: u3.user._id })).toBe(0);

    const pos = await as(u2).get(`/api/queues/${q._id}/position`);
    expect(pos.body).toMatchObject({ position: 2, totalUsers: 2 });
  });

  test("while paused, waiting users can leave and the admin can still call and serve", async () => {
    await join(u1);
    await join(u2);
    await setStatus("paused");

    expect((await as(u2).post(`/api/queues/${q._id}/leave`)).status).toBe(200);
    const next = await as(admin).post(`/api/queues/${q._id}/call-next`);
    expect(next.status).toBe(200);
    expect(next.body.queue.nowServing.token).toBe("D-1");
    expect((await as(admin).post(`/api/queues/${q._id}/serve`)).status).toBe(200);
  });

  test("resume reopens joins", async () => {
    await setStatus("paused");
    const resumed = await setStatus("open");
    expect(resumed.body).toMatchObject({ message: "Queue resumed", queue: { status: "open" } });
    expect((await join(u1)).status).toBe(200);
  });

  test("users still see a paused queue in the list (with its status)", async () => {
    await setStatus("paused");
    const list = (await as(u1).get("/api/queues")).body;
    expect(list.map((x) => [x.name, x.status])).toEqual([["Dental", "paused"]]);
  });

  test.each([["closed"], ["running"], [undefined]])("status %s via PATCH -> 400", async (status) => {
    const res = await setStatus(status);
    expect(res.status).toBe(400);
    expect((await Queue.findById(q._id)).status).toBe("open");
  });
});

describe("close (replaces delete)", () => {
  test.each([["POST /close"], ["DELETE"]])("%s cancels waiting tickets, completes the one being served, keeps history", async (how) => {
    await join(u1);
    await join(u2);
    await join(u3);
    await as(admin).post(`/api/queues/${q._id}/call-next`); // u1 serving

    const res = how === "DELETE" ? await as(admin).del(`/api/queues/${q._id}`) : await as(admin).post(`/api/queues/${q._id}/close`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ message: "Queue closed", cancelled: 2, servedCurrent: true });

    const queue = await Queue.findById(q._id);
    expect(queue.status).toBe("closed");
    expect(queue.closedAt).toBeInstanceOf(Date);
    expect(await Ticket.countDocuments({ queue: q._id, active: true })).toBe(0);
    expect((await Ticket.findOne({ user: u1.user._id })).status).toBe("served");
    expect((await Ticket.findOne({ user: u2.user._id })).status).toBe("cancelled");

    // History stays in the admin's reports (it used to vanish with the queue).
    const report = (await as(admin).get("/api/queues/admin/users-report")).body;
    expect(report.map((t) => t.status).sort()).toEqual(["cancelled", "cancelled", "served"]);
    expect(report.every((t) => t.position === -1)).toBe(true);
    const completed = (await as(admin).get("/api/queues/admin/completed-report")).body;
    expect(completed.map((t) => t.token)).toEqual(["D-1"]);
  });

  test("closed queue rejects joins, call-next and pause/resume", async () => {
    await as(admin).post(`/api/queues/${q._id}/close`);

    const j = await join(u1);
    expect(j.status).toBe(409);
    expect(j.body.code).toBe("QUEUE_CLOSED");
    expect((await as(admin).post(`/api/queues/${q._id}/call-next`)).status).toBe(409);
    expect((await setStatus("open")).status).toBe(409);
    expect((await Queue.findById(q._id)).status).toBe("closed");
  });

  test("closed queues drop out of user and admin lists", async () => {
    await as(admin).post(`/api/queues/${q._id}/close`);
    expect((await as(u1).get("/api/queues")).body).toEqual([]);
    expect((await as(admin).get("/api/queues")).body).toEqual([]);
  });

  test("a user whose ticket was cancelled by the close sees it as cancelled", async () => {
    await join(u1);
    await as(admin).post(`/api/queues/${q._id}/close`);
    const status = (await as(u1).get("/api/queues/my-status")).body;
    expect(status).toEqual([expect.objectContaining({ queueName: "Dental", status: "cancelled", token: "D-1" })]);
  });

  test("closing twice is harmless", async () => {
    await as(admin).post(`/api/queues/${q._id}/close`);
    const again = await as(admin).post(`/api/queues/${q._id}/close`);
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ cancelled: 0, servedCurrent: false });
  });
});

describe("tokens and positions (Ticket-first)", () => {
  test("tokens stay unique through call-next, leave and new joins", async () => {
    // Before: token = "D-" + waiting-list length, so D-2 was handed out twice here.
    await join(u1); // D-1
    await join(u2); // D-2
    await as(admin).post(`/api/queues/${q._id}/call-next`); // u1 to the counter
    await as(u2).post(`/api/queues/${q._id}/leave`);
    await join(u3); // D-3
    await join(u2); // D-4 (rejoin gets a new ticket)

    const tokens = (await Ticket.find({ queue: q._id }).sort({ seq: 1 })).map((t) => t.token);
    expect(tokens).toEqual(["D-1", "D-2", "D-3", "D-4"]);
  });

  test("position follows ticket order after someone ahead leaves", async () => {
    await join(u1);
    await join(u2);
    await join(u3);
    await as(u1).post(`/api/queues/${q._id}/leave`);
    expect((await as(u3).get(`/api/queues/${q._id}/position`)).body).toMatchObject({ position: 2, totalUsers: 2 });
  });

  test("my-status shows the real token, position and who is being served", async () => {
    await join(u1);
    await join(u2);
    await as(admin).post(`/api/queues/${q._id}/call-next`);
    const [mine] = (await as(u2).get("/api/queues/my-status")).body;
    expect(mine).toMatchObject({ token: "D-2", position: 1, status: "waiting", totalInQueue: 1, currentlyServing: "D-1", queueStatus: "open" });
  });

  test("the queue list exposes the waiting list and the next token", async () => {
    await join(u1);
    await join(u2);
    await as(admin).post(`/api/queues/${q._id}/call-next`);
    const [live] = (await as(admin).get("/api/queues")).body;
    expect(live).toMatchObject({ waitingCount: 1, nextToken: "D-2", nowServing: { token: "D-1" } });
    expect(live.users.map((u) => u.user)).toEqual([u2.user._id.toString()]);
  });

  test("joining again while waiting returns 200 and keeps the one ticket", async () => {
    await join(u1);
    expect((await join(u1)).status).toBe(200);
    expect(await Ticket.countDocuments({ user: u1.user._id })).toBe(1);
  });
});
