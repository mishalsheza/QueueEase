const request = require("supertest");
const express = require("express");
const app = require("../src/app");
const Queue = require("../src/models/Queue");
const Ticket = require("../src/models/Ticket");
const { requireRole } = require("../src/middleware/requireRole");
const db = require("./helpers/db");
const { createUser, createQueue } = require("./helpers/factories");

beforeAll(db.connect);
afterEach(db.clear);
afterAll(db.close);

let admin;
let user;
let queue;
beforeEach(async () => {
  admin = await createUser({ role: "admin" });
  user = await createUser();
  queue = await createQueue(admin.user);
});

const call = (actor, method, url, body) =>
  request(app)[method](url).set("Authorization", actor.auth).send(body);

describe("GET /api/auth/me is the app's source of truth for the role", () => {
  test.each([["admin"], ["user"]])("returns role=%s", async (role) => {
    const actor = role === "admin" ? admin : user;
    const res = await call(actor, "get", "/api/auth/me");
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ role, email: actor.user.email, name: actor.user.name });
    expect(res.body.user.password).toBeUndefined();
  });

  test("uses the role stored in the DB, not the one inside the token", async () => {
    // Role changed after the token was issued (e.g. promoted with create_admin.js).
    await user.user.updateOne({ role: "admin" });
    const res = await call(user, "get", "/api/auth/me");
    expect(res.body.user.role).toBe("admin");
  });
});

describe("admin-only endpoints reject regular users with 403", () => {
  // Every row has all three values: a shorter row would make Jest pass its
  // `done` callback as `body` and wait for it forever.
  const adminRoutes = [
    ["post", "/api/queues", { name: "X" }],
    ["post", "/api/queues/:id/call-next", undefined],
    ["post", "/api/queues/:id/serve", undefined],
    ["delete", "/api/queues/:id", undefined],
    ["get", "/api/queues/admin/users-report", undefined],
    ["get", "/api/queues/admin/completed-report", undefined],
  ];

  test.each(adminRoutes)("%s %s", async (method, path, body) => {
    const url = path.replace(":id", queue._id.toString());
    const res = await call(user, method, url, body);
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ message: "Admin access only", code: "FORBIDDEN" });
  });

  test("the queue is untouched after the rejected delete", async () => {
    await call(user, "delete", `/api/queues/${queue._id}`);
    expect(await Queue.countDocuments()).toBe(1);
  });
});

describe("admins cannot join or leave queues", () => {
  test("admin join -> 403 and no ticket or queue entry is created", async () => {
    const res = await call(admin, "post", `/api/queues/${queue._id}/join`);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("FORBIDDEN");
    expect(res.body.message).toMatch(/cannot join/);
    expect((await Queue.findById(queue._id)).users).toHaveLength(0);
    expect(await Ticket.countDocuments()).toBe(0);
  });

  test("admin leave -> 403", async () => {
    const res = await call(admin, "post", `/api/queues/${queue._id}/leave`);
    expect(res.status).toBe(403);
  });

  test("regular users can still join and leave", async () => {
    expect((await call(user, "post", `/api/queues/${queue._id}/join`)).status).toBe(200);
    expect((await call(user, "post", `/api/queues/${queue._id}/leave`)).status).toBe(200);
  });
});

describe("requireRole middleware", () => {
  const mini = (role, injectedUser) => {
    const a = express();
    a.get("/x", (req, res, next) => { req.user = injectedUser; next(); }, requireRole(role), (req, res) => res.json({ ok: true }));
    return a;
  };

  test("passes the matching role", async () => {
    expect((await request(mini("admin", { role: "admin" })).get("/x")).status).toBe(200);
  });

  test("rejects a missing user (used without protect)", async () => {
    expect((await request(mini("admin", undefined)).get("/x")).status).toBe(403);
  });

  test("throws at startup for an unknown role name (typo guard)", () => {
    expect(() => requireRole("admn")).toThrow("Unknown role");
  });
});
