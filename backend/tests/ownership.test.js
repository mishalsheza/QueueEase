// A3: an admin can only manage their own queues, and reports only include
// their own queues' data.
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
  del: (url) => request(app).delete(url).set("Authorization", actor.auth),
});

// Two admins, each with a queue; users waiting in both.
let adminA, adminB, u1, u2, u3, qA, qB;
beforeEach(async () => {
  adminA = await createUser({ role: "admin", name: "Admin A" });
  adminB = await createUser({ role: "admin", name: "Admin B" });
  [u1, u2, u3] = await Promise.all([createUser(), createUser(), createUser()]);

  qA = (await as(adminA).post("/api/queues", { name: "Alpha" })).body;
  qB = (await as(adminB).post("/api/queues", { name: "Beta" })).body;

  await as(u1).post(`/api/queues/${qA._id}/join`);
  await as(u2).post(`/api/queues/${qA._id}/join`);
  await as(u3).post(`/api/queues/${qB._id}/join`);
});

const FORBIDDEN = { message: "You can only manage your own queues", code: "FORBIDDEN" };

describe("another admin cannot manage my queue", () => {
  test("call-next on another admin's queue -> 403, queue and tickets unchanged", async () => {
    const res = await as(adminB).post(`/api/queues/${qA._id}/call-next`);
    expect(res.status).toBe(403);
    expect(res.body).toEqual(FORBIDDEN);

    const q = await Queue.findById(qA._id);
    expect(q.users).toHaveLength(2);
    expect(q.nowServing?.user).toBeUndefined();
    expect(await Ticket.countDocuments({ queue: qA._id, status: "waiting" })).toBe(2);
  });

  test("serve on another admin's queue -> 403, current ticket stays serving", async () => {
    await as(adminA).post(`/api/queues/${qA._id}/call-next`); // u1 now serving

    const res = await as(adminB).post(`/api/queues/${qA._id}/serve`);
    expect(res.status).toBe(403);
    expect(res.body).toEqual(FORBIDDEN);

    const q = await Queue.findById(qA._id);
    expect(q.nowServing.user.toString()).toBe(u1.user._id.toString());
    expect(q.servedToday).toBe(0);
    expect((await Ticket.findOne({ user: u1.user._id })).status).toBe("serving");
  });

  test("delete another admin's queue -> 403, queue still exists", async () => {
    const res = await as(adminB).del(`/api/queues/${qA._id}`);
    expect(res.status).toBe(403);
    expect(res.body).toEqual(FORBIDDEN);
    expect(await Queue.exists({ _id: qA._id })).toBeTruthy();
  });

  test("the owner can still call-next, serve and delete", async () => {
    expect((await as(adminA).post(`/api/queues/${qA._id}/call-next`)).status).toBe(200);
    expect((await as(adminA).post(`/api/queues/${qA._id}/serve`)).status).toBe(200);
    expect((await as(adminA).del(`/api/queues/${qA._id}`)).status).toBe(200);
    expect(await Queue.exists({ _id: qA._id })).toBeNull();
  });

  test("unknown queue id -> 404, malformed id -> 400 (not 403)", async () => {
    const missing = new mongoose.Types.ObjectId();
    expect((await as(adminA).post(`/api/queues/${missing}/call-next`)).status).toBe(404);
    expect((await as(adminA).post("/api/queues/not-an-id/call-next")).status).toBe(400);
  });

  test("a regular user is still rejected by role before ownership (403 Admin access only)", async () => {
    const res = await as(u1).post(`/api/queues/${qA._id}/call-next`);
    expect(res.status).toBe(403);
    expect(res.body.message).toBe("Admin access only");
  });
});

describe("reports only include the admin's own queues", () => {
  test("users-report is scoped per admin", async () => {
    const repA = (await as(adminA).get("/api/queues/admin/users-report")).body;
    const repB = (await as(adminB).get("/api/queues/admin/users-report")).body;

    expect(repA.map((t) => t.queueName).sort()).toEqual(["Alpha", "Alpha"]);
    expect(repA.map((t) => t.userId).sort()).toEqual([u1.user._id, u2.user._id].map(String).sort());
    expect(repB.map((t) => t.queueName)).toEqual(["Beta"]);
    expect(repB[0].userId).toBe(u3.user._id.toString());
  });

  test("completed-report is scoped per admin", async () => {
    for (const [admin, q] of [[adminA, qA], [adminB, qB]]) {
      await as(admin).post(`/api/queues/${q._id}/call-next`);
      await as(admin).post(`/api/queues/${q._id}/serve`);
    }
    const doneA = (await as(adminA).get("/api/queues/admin/completed-report")).body;
    const doneB = (await as(adminB).get("/api/queues/admin/completed-report")).body;

    expect(doneA.map((t) => t.queueName)).toEqual(["Alpha"]);
    expect(doneA[0].user._id).toBe(u1.user._id.toString());
    expect(doneB.map((t) => t.queueName)).toEqual(["Beta"]);
    expect(doneB[0].user._id).toBe(u3.user._id.toString());
  });

  test("an admin with no queues gets empty reports", async () => {
    const newAdmin = await createUser({ role: "admin" });
    expect((await as(newAdmin).get("/api/queues/admin/users-report")).body).toEqual([]);
    expect((await as(newAdmin).get("/api/queues/admin/completed-report")).body).toEqual([]);
  });
});

describe("queue list", () => {
  test("admins only see their own queues", async () => {
    const listA = (await as(adminA).get("/api/queues")).body;
    const listB = (await as(adminB).get("/api/queues")).body;
    expect(listA.map((q) => q.name)).toEqual(["Alpha"]);
    expect(listB.map((q) => q.name)).toEqual(["Beta"]);
  });

  test("users still see every queue so they can join any of them", async () => {
    const list = (await as(u1).get("/api/queues")).body;
    expect(list.map((q) => q.name).sort()).toEqual(["Alpha", "Beta"]);
  });
});
