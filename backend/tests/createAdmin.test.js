const request = require("supertest");
const app = require("../src/app");
const User = require("../src/models/User");
const { createAdmin, parseArgs } = require("../scripts/create_admin");
const db = require("./helpers/db");

beforeAll(db.connect);
afterEach(db.clear);
afterAll(db.close);

describe("scripts/create_admin.js", () => {
  test("creates a new admin who can log in and create a queue", async () => {
    const { action, user } = await createAdmin({ name: "Jane", email: "jane@test.com", password: "secret123" });
    expect(action).toBe("created");
    expect(user.role).toBe("admin");

    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({ email: "jane@test.com", password: "secret123" });
    expect(loginRes.status).toBe(200);
    expect(loginRes.body.user.role).toBe("admin");

    const queueRes = await request(app)
      .post("/api/queues")
      .set("Authorization", `Bearer ${loginRes.body.token}`)
      .send({ name: "Dental" });
    expect(queueRes.status).toBe(201);
  });

  test("promotes an existing user without changing their password", async () => {
    await request(app).post("/api/auth/register").send({ name: "Bob", email: "bob@test.com", password: "secret123" });
    const before = await User.findOne({ email: "bob@test.com" });

    const { action, user } = await createAdmin({ email: "bob@test.com" });
    expect(action).toBe("promoted");
    expect(user.role).toBe("admin");
    expect(user.password).toBe(before.password);

    const loginRes = await request(app).post("/api/auth/login").send({ email: "bob@test.com", password: "secret123" });
    expect(loginRes.body.user.role).toBe("admin");
  });

  test("running it twice is a no-op", async () => {
    await createAdmin({ name: "Jane", email: "jane@test.com", password: "secret123" });
    const { action } = await createAdmin({ name: "Jane", email: "jane@test.com", password: "secret123" });
    expect(action).toBe("unchanged");
    expect(await User.countDocuments()).toBe(1);
  });

  test("requires email, and name + password for a new admin", async () => {
    await expect(createAdmin({})).rejects.toThrow("--email");
    await expect(createAdmin({ email: "new@test.com", password: "secret123" })).rejects.toThrow("--name");
    await expect(createAdmin({ email: "new@test.com", name: "New" })).rejects.toThrow("ADMIN_PASSWORD");
    expect(await User.countDocuments()).toBe(0);
  });

  test("parseArgs reads --key value pairs and rejects junk", () => {
    expect(parseArgs(["--name", "Jane Admin", "--email", "j@test.com"])).toEqual({
      name: "Jane Admin",
      email: "j@test.com",
    });
    expect(() => parseArgs(["--email"])).toThrow();
    expect(() => parseArgs(["oops", "x"])).toThrow();
  });
});
