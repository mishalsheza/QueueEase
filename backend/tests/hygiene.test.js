// A6: no secrets in logs, no debug routes, and the User pre-save hook works
// on Mongoose 9 (which no longer passes `next` to async hooks).
const request = require("supertest");
const app = require("../src/app");
const User = require("../src/models/User");
const db = require("./helpers/db");

beforeAll(db.connect);
afterEach(db.clear);
afterAll(db.close);

/** Captures everything written through console.* while fn runs. */
async function captureLogs(fn) {
  const lines = [];
  const spies = ["log", "info", "warn", "error", "debug"].map((m) =>
    jest.spyOn(console, m).mockImplementation((...args) => {
      lines.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
    })
  );
  try {
    await fn();
  } finally {
    spies.forEach((s) => s.mockRestore());
  }
  return lines.join("\n");
}

describe("auth routes don't log secrets", () => {
  const PASSWORD = "Sup3r-Secret-pw";
  const creds = { name: "Ann", email: "ann@test.com", password: PASSWORD };

  test("register and login: no password, hash, token or auth header in logs", async () => {
    let token;
    const logs = await captureLogs(async () => {
      const reg = await request(app).post("/api/auth/register").send(creds);
      expect(reg.status).toBe(201);
      const login = await request(app)
        .post("/api/auth/login")
        .set("Authorization", "Bearer some-old-token")
        .send({ email: creds.email, password: PASSWORD });
      expect(login.status).toBe(200);
      token = login.body.token;
    });

    const hash = (await User.findOne({ email: creds.email })).password;
    expect(logs).not.toContain(PASSWORD);
    expect(logs).not.toContain(hash.slice(0, 20));
    expect(logs).not.toContain(token.slice(0, 20));
    expect(logs).not.toContain("some-old-token");
  });

  test("failed login: the attempted password is not logged", async () => {
    await request(app).post("/api/auth/register").send(creds);
    const logs = await captureLogs(async () => {
      const res = await request(app)
        .post("/api/auth/login")
        .send({ email: creds.email, password: "Wrong-Guess-123" });
      expect(res.status).toBe(400);
    });
    expect(logs).not.toContain("Wrong-Guess-123");
  });
});

describe("debug routes are gone", () => {
  test.each(["/cors-test", "/api/auth/test", "/api/auth/test-protected"])("GET %s -> 404", async (url) => {
    const res = await request(app).get(url);
    expect(res.status).toBe(404);
  });

  test("health check on / still answers", async () => {
    expect((await request(app).get("/")).status).toBe(200);
  });
});

describe("User pre-save hook (Mongoose 9)", () => {
  test("saving a user without changing the password works and keeps the hash", async () => {
    const user = await User.create({ name: "A", email: "a@test.com", password: "secret123" });
    const hash = user.password;

    user.name = "B";
    await user.save(); // threw "next is not a function" before the fix

    const reloaded = await User.findById(user._id);
    expect(reloaded.name).toBe("B");
    expect(reloaded.password).toBe(hash); // not hashed a second time
    expect(await reloaded.matchPassword("secret123")).toBe(true);
  });

  test("changing the password hashes the new one", async () => {
    const user = await User.create({ name: "A", email: "a@test.com", password: "secret123" });
    user.password = "newpass456";
    await user.save();

    const reloaded = await User.findById(user._id);
    expect(reloaded.password).not.toBe("newpass456");
    expect(await reloaded.matchPassword("newpass456")).toBe(true);
    expect(await reloaded.matchPassword("secret123")).toBe(false);
  });
});
