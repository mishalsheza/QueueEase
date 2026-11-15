// B1 + B2: every route that takes input validates body and params before
// touching the database, and login doesn't reveal whether an email exists.
const request = require("supertest");
const bcrypt = require("bcryptjs");
const app = require("../src/app");
const User = require("../src/models/User");
const Queue = require("../src/models/Queue");
const db = require("./helpers/db");
const { createUser } = require("./helpers/factories");

beforeAll(db.connect);
afterEach(async () => {
  jest.restoreAllMocks();
  await db.clear();
});
afterAll(db.close);

const post = (url, body, actor) => {
  const r = request(app).post(url);
  if (actor) r.set("Authorization", actor.auth);
  return r.send(body);
};
const patch = (url, body, actor) => request(app).patch(url).set("Authorization", actor.auth).send(body);
const fields = (res) => res.body.errors.map((e) => e.field);

describe("B2: login does not reveal whether an email exists", () => {
  beforeEach(async () => {
    await post("/api/auth/register", { name: "Ann", email: "ann@test.com", password: "secret123" });
  });

  test("unknown email and wrong password get the identical 401 response", async () => {
    const unknown = await post("/api/auth/login", { email: "nobody@test.com", password: "secret123" });
    const wrong = await post("/api/auth/login", { email: "ann@test.com", password: "wrong-pass" });
    expect(unknown.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(unknown.body).toEqual({ message: "Invalid email or password", code: "INVALID_CREDENTIALS" });
    expect(wrong.body).toEqual(unknown.body);
    expect(JSON.stringify(unknown.body)).not.toContain("nobody@test.com"); // no echo
  });

  test("both cases run one bcrypt compare, so timing doesn't tell them apart", async () => {
    const compare = jest.spyOn(bcrypt, "compare");
    await post("/api/auth/login", { email: "nobody@test.com", password: "secret123" });
    expect(compare).toHaveBeenCalledTimes(1);
    compare.mockClear();
    await post("/api/auth/login", { email: "ann@test.com", password: "wrong-pass" });
    expect(compare).toHaveBeenCalledTimes(1);
  });

  test("the dummy compare can never log anyone in", async () => {
    const res = await post("/api/auth/login", { email: "nobody@test.com", password: "not-a-real-password" });
    expect(res.status).toBe(401);
    expect(res.body.token).toBeUndefined();
  });

  test("correct credentials still log in", async () => {
    const res = await post("/api/auth/login", { email: "ann@test.com", password: "secret123" });
    expect(res.status).toBe(200);
    expect(res.body.token).toEqual(expect.any(String));
  });
});

describe("B1: register", () => {
  test("missing everything -> 400 listing each field", async () => {
    const res = await post("/api/auth/register", {});
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ message: "Validation failed", code: "VALIDATION_ERROR" });
    expect(res.body.errors).toEqual([
      { field: "name", message: "is required" },
      { field: "email", message: "is required" },
      { field: "password", message: "is required" },
    ]);
  });

  test.each([
    ["name only spaces", { name: "   " }, "name"],
    ["name too long", { name: "x".repeat(101) }, "name"],
    ["invalid email", { email: "not-an-email" }, "email"],
    ["password too short", { password: "12345" }, "password"],
    ["password over bcrypt's 72-byte limit", { password: "p".repeat(73) }, "password"],
  ])("%s -> 400 on that field, nothing saved", async (_label, override, field) => {
    const create = jest.spyOn(User, "create");
    const res = await post("/api/auth/register", { name: "Ann", email: "ann@test.com", password: "secret123", ...override });
    expect(res.status).toBe(400);
    expect(fields(res)).toEqual([field]);
    expect(create).not.toHaveBeenCalled();
  });

  test("name and email are trimmed; a 72-character password works", async () => {
    const pw = "p".repeat(72);
    const res = await post("/api/auth/register", { name: "  Ann  ", email: " ann@test.com ", password: pw });
    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ name: "Ann", email: "ann@test.com", role: "user" });
    expect((await post("/api/auth/login", { email: "ann@test.com", password: pw })).status).toBe(200);
  });

  test("a non-object body -> 400", async () => {
    const res = await request(app).post("/api/auth/register").send(["Ann", "ann@test.com", "secret123"]);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });

  test("duplicate email -> 400 DUPLICATE_EMAIL", async () => {
    const body = { name: "Ann", email: "ann@test.com", password: "secret123" };
    await post("/api/auth/register", body);
    const res = await post("/api/auth/register", body);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ message: "User with this email already exists", code: "DUPLICATE_EMAIL" });
  });
});

describe("B1: login", () => {
  test("missing fields -> 400 listing them, no DB query", async () => {
    const findOne = jest.spyOn(User, "findOne");
    const res = await post("/api/auth/login", {});
    expect(res.status).toBe(400);
    expect(fields(res)).toEqual(["email", "password"]);
    expect(findOne).not.toHaveBeenCalled();
  });

  test("empty strings -> 400", async () => {
    expect((await post("/api/auth/login", { email: "", password: "" })).status).toBe(400);
  });
});

describe("B1: queue routes", () => {
  let admin, q;
  beforeEach(async () => {
    admin = await createUser({ role: "admin" });
    q = await Queue.create({ name: "Clinic", admin: admin.user._id });
  });

  test.each([
    ["missing name", {}, "name"],
    ["blank name", { name: "  " }, "name"],
    ["name as object", { name: { $gt: "" } }, "name"],
    ["name too long", { name: "x".repeat(101) }, "name"],
    ["unknown section", { name: "A", section: "E" }, "section"],
    ["type too long", { name: "A", type: "t".repeat(51) }, "type"],
    ["graceMinutes as a string", { name: "A", graceMinutes: "5" }, "graceMinutes"],
  ])("create queue: %s -> 400, nothing created", async (_label, body, field) => {
    const create = jest.spyOn(Queue, "create");
    const res = await post("/api/queues", body, admin);
    expect(res.status).toBe(400);
    expect(fields(res)).toEqual([field]);
    expect(create).not.toHaveBeenCalled();
  });

  test("create queue: unknown fields are dropped (can't set admin, status or counters)", async () => {
    const other = await createUser({ role: "admin" });
    const res = await post("/api/queues", { name: "  Lab  ", admin: other.user._id, status: "closed", lastSeq: 99, servedToday: 50 }, admin);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: "Lab", status: "open", lastSeq: 0, servedToday: 0 });
    expect(res.body.admin).toBe(admin.user._id.toString());
  });

  test("status: missing or invalid -> 400 with the allowed values", async () => {
    for (const body of [{}, { status: "closed" }, { status: ["open"] }]) {
      const res = await patch(`/api/queues/${q._id}/status`, body, admin);
      expect(res.status).toBe(400);
      expect(res.body.errors).toEqual([{ field: "status", message: 'must be "open" or "paused" (use close to close a queue)' }]);
    }
  });

  test("settings: missing graceMinutes -> 400 'is required'", async () => {
    const res = await patch(`/api/queues/${q._id}/settings`, {}, admin);
    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual([{ field: "graceMinutes", message: "is required" }]);
  });

  test.each(["serve", "no-show"])("%s: ticketId that isn't an id -> 400 'must be a valid id'", async (action) => {
    const res = await post(`/api/queues/${q._id}/${action}`, { ticketId: "abc" }, admin);
    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual([{ field: "ticketId", message: "must be a valid id" }]);
  });

  test("validation runs after login and role checks (no info for strangers)", async () => {
    expect((await request(app).post("/api/queues").send({})).status).toBe(401);
    const user = await createUser();
    expect((await post("/api/queues", {}, user)).status).toBe(403);
  });
});
