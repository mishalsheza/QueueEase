const request = require("supertest");
const jwt = require("jsonwebtoken");
const app = require("../src/app");
const User = require("../src/models/User");
const db = require("./helpers/db");
const { createUser } = require("./helpers/factories");

beforeAll(db.connect);
afterEach(db.clear);
afterAll(db.close);

const me = (authHeader) => {
  const req = request(app).get("/api/auth/me");
  return authHeader === undefined ? req : req.set("Authorization", authHeader);
};

describe("protect middleware", () => {
  test("valid token -> 200 with user, password not exposed", async () => {
    const { user, auth } = await createUser();
    const res = await me(auth);
    expect(res.status).toBe(200);
    expect(res.body.user._id).toBe(user._id.toString());
    expect(res.body.user.password).toBeUndefined();
  });

  test.each([
    ["no header", undefined],
    ["'Bearer' with no token (used to crash the server)", "Bearer"],
    ["'Bearer ' with empty token", "Bearer "],
    ["wrong scheme", "Basic abc123"],
    ["malformed jwt", "Bearer not.a.jwt"],
  ])("%s -> 401", async (_label, header) => {
    const res = await me(header);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("UNAUTHORIZED");
  });

  test("token signed with a different secret -> 401", async () => {
    const { user } = await createUser();
    const forged = jwt.sign({ id: user._id, role: "admin" }, "attacker-secret");
    const res = await me(`Bearer ${forged}`);
    expect(res.status).toBe(401);
  });

  test("expired token -> 401", async () => {
    const { user } = await createUser();
    const expired = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: -10 });
    const res = await me(`Bearer ${expired}`);
    expect(res.status).toBe(401);
  });

  test("valid token for a deleted user -> 401 (was 200 with user: null)", async () => {
    const { user, auth } = await createUser();
    await User.deleteOne({ _id: user._id });
    const res = await me(auth);
    expect(res.status).toBe(401);
  });

  test("deleted user cannot reach routes that dereference req.user (was 500)", async () => {
    const { user, auth } = await createUser();
    await User.deleteOne({ _id: user._id });
    const res = await request(app).get("/api/queues/my-status").set("Authorization", auth);
    expect(res.status).toBe(401);
  });

  test("server keeps serving after a bad 'Bearer' header", async () => {
    await me("Bearer");
    const { auth } = await createUser();
    const res = await me(auth);
    expect(res.status).toBe(200);
  });

  test("DB failure while loading the user -> 500, not 401", async () => {
    const { auth } = await createUser();
    const spy = jest.spyOn(User, "findById").mockImplementation(() => {
      throw new Error("db down");
    });
    try {
      const res = await me(auth);
      expect(res.status).toBe(500);
      expect(res.body).toEqual({ message: "Internal server error", code: "INTERNAL" });
    } finally {
      spy.mockRestore();
    }
  });
});
