// GET /api/health: used by the Docker HEALTHCHECK. 200 only while MongoDB is
// connected, 503 otherwise, and no auth needed.
const request = require("supertest");
const app = require("../src/app");
const db = require("./helpers/db");

describe("GET /api/health", () => {
  afterAll(async () => {
    if (require("mongoose").connection.readyState !== 0) await db.close();
  });

  test("503 while the database is not connected", async () => {
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: "unavailable", db: "disconnected" });
  });

  test("200 once the database is connected, without a token", async () => {
    await db.connect();
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok", db: "connected" });
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  test("503 again after the database disconnects", async () => {
    await db.close();
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(503);
    expect(res.body.db).toBe("disconnected");
  });
});
