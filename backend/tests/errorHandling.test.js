const request = require("supertest");
const mongoose = require("mongoose");
const app = require("../src/app");
const Queue = require("../src/models/Queue");
const { toHttpError } = require("../src/middleware/errorHandler");
const db = require("./helpers/db");
const { createUser, createQueue } = require("./helpers/factories");

beforeAll(db.connect);
afterEach(db.clear);
afterAll(db.close);

let admin;
let user;
beforeEach(async () => {
  admin = await createUser({ role: "admin" });
  user = await createUser();
});

// Every route that takes :queueId. Each of these used to either crash the
// process (no try/catch) or return a 500 that leaked the Mongoose message.
const queueIdRoutes = [
  ["post", "join", "user"],
  ["post", "leave", "user"],
  ["get", "position", "user"],
  ["post", "call-next", "admin"],
  ["post", "serve", "admin"],
  ["delete", "", "admin"],
];

describe("invalid and unknown ids", () => {
  test.each(queueIdRoutes)("%s /:queueId/%s with malformed id -> 400", async (method, path, who) => {
    const actor = who === "admin" ? admin : user;
    const url = `/api/queues/not-an-id${path ? `/${path}` : ""}`;
    const res = await request(app)[method](url).set("Authorization", actor.auth);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ message: "Invalid _id", code: "INVALID_ID" });
  });

  test.each(queueIdRoutes)("%s /:queueId/%s with unknown valid id -> 404", async (method, path, who) => {
    const actor = who === "admin" ? admin : user;
    const id = new mongoose.Types.ObjectId();
    const url = `/api/queues/${id}${path ? `/${path}` : ""}`;
    const res = await request(app)[method](url).set("Authorization", actor.auth);
    expect(res.status).toBe(404);
  });
});

describe("validation and malformed input", () => {
  test("create queue without name -> 400 with field details (used to crash)", async () => {
    const res = await request(app).post("/api/queues").set("Authorization", admin.auth).send({});
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
    expect(res.body.errors).toEqual([expect.objectContaining({ field: "name" })]);
  });

  test("malformed JSON body -> 400", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .set("Content-Type", "application/json")
      .send('{"email": ');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("BAD_JSON");
  });

  test("unknown route -> 404 JSON", async () => {
    const res = await request(app).get("/api/nope");
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("NOT_FOUND");
  });
});

describe("unexpected errors", () => {
  test("500 response does not leak internal error messages", async () => {
    const spy = jest.spyOn(Queue, "find").mockImplementation(() => {
      throw new Error("connection string mongodb+srv://secret");
    });
    const errSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    try {
      const res = await request(app).get("/api/queues").set("Authorization", user.auth);
      expect(res.status).toBe(500);
      expect(res.body).toEqual({ message: "Internal server error", code: "INTERNAL" });
      expect(JSON.stringify(res.body)).not.toMatch(/secret/);
      expect(errSpy).toHaveBeenCalled(); // still logged server-side
    } finally {
      spy.mockRestore();
      errSpy.mockRestore();
    }
  });

  test("app keeps serving after a route error", async () => {
    await request(app).get("/api/queues/not-an-id/position").set("Authorization", user.auth);
    await request(app).post("/api/queues").set("Authorization", admin.auth).send({});
    const res = await request(app).get("/");
    expect(res.status).toBe(200);
  });

  test("concurrent leave + join no longer crashes; any conflict is a 409, not a dropped request", async () => {
    const queue = await createQueue(admin.user);
    const waiting = await Promise.all(Array.from({ length: 8 }, () => createUser()));
    for (const w of waiting) {
      await request(app).post(`/api/queues/${queue._id}/join`).set("Authorization", w.auth);
    }
    const joiners = await Promise.all(Array.from({ length: 8 }, () => createUser()));

    const responses = await Promise.all([
      ...joiners.map((j) => request(app).post(`/api/queues/${queue._id}/join`).set("Authorization", j.auth)),
      ...waiting.slice(0, 4).map((w) => request(app).post(`/api/queues/${queue._id}/leave`).set("Authorization", w.auth)),
      request(app).post(`/api/queues/${queue._id}/call-next`).set("Authorization", admin.auth),
    ]);

    // Every request gets a real HTTP answer. The race itself (A4) is not fixed
    // yet, so some requests may legitimately lose with 409.
    for (const r of responses) expect([200, 409]).toContain(r.status);
    expect((await request(app).get("/")).status).toBe(200);
  });
});

describe("toHttpError mapping", () => {
  test("VersionError -> 409 CONFLICT", () => {
    const err = new mongoose.Error.VersionError(new Queue({ name: "x" }), 1, ["users"]);
    expect(toHttpError(err)).toEqual({
      status: 409,
      body: { message: expect.any(String), code: "CONFLICT" },
    });
  });

  test("duplicate key (11000) -> 409 DUPLICATE", () => {
    expect(toHttpError({ code: 11000 }).status).toBe(409);
  });

  test("anything else -> generic 500", () => {
    expect(toHttpError(new TypeError("boom"))).toEqual({
      status: 500,
      body: { message: "Internal server error", code: "INTERNAL" },
    });
  });
});
