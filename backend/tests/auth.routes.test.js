const request = require("supertest");
const app = require("../src/app");
const User = require("../src/models/User");
const db = require("./helpers/db");
const { createUser } = require("./helpers/factories");

beforeAll(db.connect);
afterEach(async () => {
  jest.restoreAllMocks();
  await db.clear();
});
afterAll(db.close);

const register = (body) => request(app).post("/api/auth/register").send(body);
const login = (body) => request(app).post("/api/auth/login").send(body);

describe("register cannot create admins", () => {
  test.each(["admin", "ADMIN", "superadmin", ["admin"], { $ne: "user" }])(
    "role=%j in body -> account is created as a regular user",
    async (role) => {
      const res = await register({ name: "Eve", email: "eve@test.com", password: "secret123", role });
      expect(res.status).toBe(201);
      expect(res.body.user.role).toBe("user");
      expect((await User.findOne({ email: "eve@test.com" })).role).toBe("user");
    }
  );

  test("token from a self-declared admin signup cannot create a queue", async () => {
    const { body } = await register({ name: "Eve", email: "eve@test.com", password: "secret123", role: "admin" });
    const res = await request(app)
      .post("/api/queues")
      .set("Authorization", `Bearer ${body.token}`)
      .send({ name: "Hijacked" });
    expect(res.status).toBe(403);
  });
});

describe("NoSQL operator injection is rejected before reaching the DB", () => {
  beforeEach(async () => {
    await createUser(); // a user an injected query could otherwise match
  });

  test('login with {"email": {"$gt": ""}} -> 400 and no DB query', async () => {
    const findOne = jest.spyOn(User, "findOne");
    const res = await login({ email: { $gt: "" }, password: "secret123" });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      code: "VALIDATION_ERROR",
      errors: [{ field: "email", message: "must be a string" }],
    });
    expect(findOne).not.toHaveBeenCalled();
    expect(res.body.token).toBeUndefined();
  });

  test('login with {"password": {"$gt": ""}} -> 400 (was 500)', async () => {
    const res = await login({ email: "user1@test.com", password: { $gt: "" } });
    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual([{ field: "password", message: "must be a string" }]);
  });

  test("login with both fields as operators reports both", async () => {
    const res = await login({ email: { $gt: "" }, password: { $ne: null } });
    expect(res.status).toBe(400);
    expect(res.body.errors.map((e) => e.field)).toEqual(["email", "password"]);
  });

  test.each([
    ["array", ["a@test.com"]],
    ["number", 123],
    ["boolean", true],
    ["regex-style operator", { $regex: ".*" }],
  ])("login with email as %s -> 400", async (_label, email) => {
    const res = await login({ email, password: "secret123" });
    expect(res.status).toBe(400);
  });

  test.each(["name", "email", "password"])(
    "register with %s as an object -> 400 and no DB query",
    async (field) => {
      const findOne = jest.spyOn(User, "findOne");
      const body = { name: "Eve", email: "eve@test.com", password: "secret123", [field]: { $gt: "" } };
      const res = await register(body);
      expect(res.status).toBe(400);
      expect(res.body.errors).toEqual([{ field, message: "must be a string" }]);
      expect(findOne).not.toHaveBeenCalled();
    }
  );
});

describe("normal auth still works", () => {
  test("string credentials log in", async () => {
    await register({ name: "Ann", email: "ann@test.com", password: "secret123" });
    const res = await login({ email: "ann@test.com", password: "secret123" });
    expect(res.status).toBe(200);
    expect(res.body.token).toEqual(expect.any(String));
  });

  test("missing fields are still a 400 from the presence check", async () => {
    expect((await login({ email: "ann@test.com" })).status).toBe(400);
    expect((await register({ email: "ann@test.com", password: "secret123" })).status).toBe(400);
  });
});
