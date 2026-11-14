// Happy-path coverage of the main flows. Guards the move of route mounting
// from server.js into app.js and gives later refactors a safety net.
const request = require("supertest");
const app = require("../src/app");
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

describe("auth", () => {
  test("register -> login -> me", async () => {
    const reg = await request(app)
      .post("/api/auth/register")
      .send({ name: "Ann", email: "ann@test.com", password: "secret123" });
    expect(reg.status).toBe(201);
    expect(reg.body.token).toEqual(expect.any(String));
    expect(reg.body.user.role).toBe("user");

    const login = await request(app)
      .post("/api/auth/login")
      .send({ email: "ann@test.com", password: "secret123" });
    expect(login.status).toBe(200);

    const me = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${login.body.token}`);
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe("ann@test.com");
  });

  test("register with duplicate email -> 400", async () => {
    const body = { name: "Ann", email: "dup@test.com", password: "secret123" };
    await request(app).post("/api/auth/register").send(body);
    const res = await request(app).post("/api/auth/register").send(body);
    expect(res.status).toBe(400);
  });

  test("register with missing fields -> 400", async () => {
    const res = await request(app).post("/api/auth/register").send({ email: "x@test.com" });
    expect(res.status).toBe(400);
  });

  test("login with wrong password -> 400", async () => {
    await request(app)
      .post("/api/auth/register")
      .send({ name: "Ann", email: "ann@test.com", password: "secret123" });
    const res = await request(app).post("/api/auth/login").send({ email: "ann@test.com", password: "nope" });
    expect(res.status).toBe(400);
  });
});

describe("queue lifecycle", () => {
  test("create -> join -> position -> call-next -> serve -> history -> delete", async () => {
    const admin = await createUser({ role: "admin" });
    const u1 = await createUser();
    const u2 = await createUser();

    const created = await as(admin).post("/api/queues", { name: "Dental" });
    expect(created.status).toBe(201);
    const qid = created.body._id;

    expect((await as(u1).post(`/api/queues/${qid}/join`)).status).toBe(200);
    expect((await as(u2).post(`/api/queues/${qid}/join`)).status).toBe(200);

    const pos = await as(u2).get(`/api/queues/${qid}/position`);
    expect(pos.body).toEqual({ queueName: "Dental", position: 2, totalUsers: 2 });

    const next = await as(admin).post(`/api/queues/${qid}/call-next`);
    expect(next.status).toBe(200);
    expect(next.body.queue.nowServing.user).toBe(u1.user._id.toString());

    const status = await as(u1).get("/api/queues/my-status");
    expect(status.body[0]).toMatchObject({ status: "serving", position: 0 });

    expect((await as(admin).post(`/api/queues/${qid}/serve`)).status).toBe(200);
    const history = await as(u1).get("/api/queues/my-history");
    expect(history.body).toEqual([expect.objectContaining({ status: "served" })]);

    const report = await as(admin).get("/api/queues/admin/users-report");
    expect(report.status).toBe(200);
    expect(report.body.map((t) => t.status).sort()).toEqual(["served", "waiting"]);

    const completed = await as(admin).get("/api/queues/admin/completed-report");
    expect(completed.body).toHaveLength(1);

    expect((await as(admin).del(`/api/queues/${qid}`)).status).toBe(200);
    expect((await as(u1).get("/api/queues")).body).toEqual([]);
  });

  test("leave cancels the waiting ticket", async () => {
    const admin = await createUser({ role: "admin" });
    const u = await createUser();
    const { body: q } = await as(admin).post("/api/queues", { name: "Pharmacy" });
    await as(u).post(`/api/queues/${q._id}/join`);

    const res = await as(u).post(`/api/queues/${q._id}/leave`);
    expect(res.status).toBe(200);
    expect(res.body.users).toHaveLength(0);
    expect((await Ticket.findOne({ user: u.user._id })).status).toBe("cancelled");
  });

  test("call-next on empty queue -> 400; serve with nobody serving -> 400", async () => {
    const admin = await createUser({ role: "admin" });
    const { body: q } = await as(admin).post("/api/queues", { name: "Empty" });
    expect((await as(admin).post(`/api/queues/${q._id}/call-next`)).status).toBe(400);
    expect((await as(admin).post(`/api/queues/${q._id}/serve`)).status).toBe(400);
  });

  test("non-admin is blocked from admin actions", async () => {
    const admin = await createUser({ role: "admin" });
    const u = await createUser();
    const { body: q } = await as(admin).post("/api/queues", { name: "X" });

    expect((await as(u).post("/api/queues", { name: "Y" })).status).toBe(403);
    expect((await as(u).post(`/api/queues/${q._id}/call-next`)).status).toBe(403);
    expect((await as(u).post(`/api/queues/${q._id}/serve`)).status).toBe(403);
    expect((await as(u).del(`/api/queues/${q._id}`)).status).toBe(403);
    expect((await as(u).get("/api/queues/admin/users-report")).status).toBe(403);
    expect((await as(u).get("/api/queues/admin/completed-report")).status).toBe(403);
  });
});

// Known bugs from the audit, fixed in later plan items.
test.todo("A4: tokens are unique per queue, including after call-next");
test.todo("A4: concurrent joins by the same user create one ticket");
