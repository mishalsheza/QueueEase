// B6: helmet headers, CORS allowlist (REST and Socket.io), auth rate limits,
// and the startup configuration check.
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const { execFileSync } = require("child_process");
const request = require("supertest");
const { io: connect } = require("socket.io-client");
const app = require("../src/app");
const { createApp } = require("../src/app");
const { attachSocket } = require("../src/realtime/socket");
const { loadConfig } = require("../src/config/env");
const db = require("./helpers/db");
const { createUser } = require("./helpers/factories");

beforeAll(db.connect);
afterEach(db.clear);
afterAll(db.close);

const ALLOWED = "http://localhost:8081";

describe("helmet security headers", () => {
  test("set on API responses; X-Powered-By removed", async () => {
    const res = await request(app).get("/");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-frame-options"]).toBe("SAMEORIGIN");
    expect(res.headers["strict-transport-security"]).toMatch(/max-age=/);
    expect(res.headers["content-security-policy"]).toBeDefined();
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });

  test("also on errors (404)", async () => {
    const res = await request(app).get("/nope");
    expect(res.status).toBe(404);
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });
});

describe("CORS allowlist (REST)", () => {
  test("an allowed origin gets CORS headers", async () => {
    const res = await request(app).get("/").set("Origin", ALLOWED);
    expect(res.headers["access-control-allow-origin"]).toBe(ALLOWED);
    expect(res.headers["access-control-allow-credentials"]).toBe("true");
  });

  test("allowed preflight -> 204 with methods and headers", async () => {
    const res = await request(app)
      .options("/api/queues")
      .set("Origin", ALLOWED)
      .set("Access-Control-Request-Method", "POST")
      .set("Access-Control-Request-Headers", "authorization,content-type");
    expect(res.status).toBe(204);
    expect(res.headers["access-control-allow-origin"]).toBe(ALLOWED);
    expect(res.headers["access-control-allow-methods"]).toMatch(/POST/);
  });

  test.each(["http://evil.example.com", "http://localhost:8082", "null"])("origin %s gets no CORS headers", async (origin) => {
    const res = await request(app).get("/").set("Origin", origin);
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    const pre = await request(app).options("/api/auth/login").set("Origin", origin).set("Access-Control-Request-Method", "POST");
    expect(pre.headers["access-control-allow-origin"]).toBeUndefined();
  });

  test("no Origin (native app, curl) still works", async () => {
    expect((await request(app).get("/")).status).toBe(200);
  });
});

describe("auth rate limits", () => {
  // Own app with a low limit; the shared test app's limit is very high.
  const limited = (overrides = {}) =>
    createApp({ corsOrigins: [ALLOWED], authRateLimit: { max: 3, windowMs: 60 * 1000 }, trustProxy: false, ...overrides });
  const creds = { email: "ann@test.com", password: "secret123" };
  beforeEach(async () => {
    await request(app).post("/api/auth/register").send({ name: "Ann", ...creds });
  });

  test("4th failed login from one IP -> 429 RATE_LIMITED with Retry-After", async () => {
    const a = limited();
    for (let i = 0; i < 3; i += 1) {
      expect((await request(a).post("/api/auth/login").send({ ...creds, password: "wrong" })).status).toBe(401);
    }
    const res = await request(a).post("/api/auth/login").send({ ...creds, password: "wrong" });
    expect(res.status).toBe(429);
    expect(res.body).toEqual({ message: "Too many attempts, please try again later", code: "RATE_LIMITED" });
    expect(Number(res.headers["retry-after"])).toBeGreaterThan(0);
    expect(res.headers.ratelimit).toMatch(/limit=3/);
    // While limited, even the right password is refused.
    expect((await request(a).post("/api/auth/login").send(creds)).status).toBe(429);
  });

  test("successful logins don't count against the limit", async () => {
    const a = limited();
    for (let i = 0; i < 6; i += 1) {
      expect((await request(a).post("/api/auth/login").send(creds)).status).toBe(200);
    }
  });

  test("register counts every attempt", async () => {
    const a = limited();
    for (let i = 0; i < 3; i += 1) {
      await request(a).post("/api/auth/register").send({ name: "X", email: `x${i}@test.com`, password: "secret123" });
    }
    expect((await request(a).post("/api/auth/register").send({ name: "X", email: "x9@test.com", password: "secret123" })).status).toBe(429);
  });

  test("other routes are not limited (GET /me is called on every app start)", async () => {
    const a = limited();
    const u = await createUser();
    for (let i = 0; i < 6; i += 1) {
      expect((await request(a).get("/api/auth/me").set("Authorization", u.auth)).status).toBe(200);
    }
  });

  test("without TRUST_PROXY, a spoofed X-Forwarded-For can't dodge the limit", async () => {
    const a = limited();
    for (let i = 0; i < 3; i += 1) {
      await request(a).post("/api/auth/login").set("X-Forwarded-For", `10.0.0.${i}`).send({ ...creds, password: "wrong" });
    }
    const res = await request(a).post("/api/auth/login").set("X-Forwarded-For", "10.0.0.99").send({ ...creds, password: "wrong" });
    expect(res.status).toBe(429);
  });

  test("with TRUST_PROXY=1, clients behind the proxy are counted separately", async () => {
    const a = limited({ trustProxy: true });
    for (let i = 0; i < 3; i += 1) {
      await request(a).post("/api/auth/login").set("X-Forwarded-For", "10.0.0.1").send({ ...creds, password: "wrong" });
    }
    expect((await request(a).post("/api/auth/login").set("X-Forwarded-For", "10.0.0.1").send({ ...creds, password: "wrong" })).status).toBe(429);
    expect((await request(a).post("/api/auth/login").set("X-Forwarded-For", "10.0.0.2").send({ ...creds, password: "wrong" })).status).toBe(401);
  });
});

describe("CORS allowlist (Socket.io handshake)", () => {
  let server, io, url;
  beforeAll(async () => {
    server = http.createServer(app);
    io = attachSocket(server, { corsOrigins: [ALLOWED] });
    await new Promise((r) => server.listen(0, r));
    url = `http://127.0.0.1:${server.address().port}`;
  });
  afterAll(async () => {
    io.close();
    await new Promise((r) => server.close(r));
  });

  const tryConnect = (token, origin) =>
    new Promise((resolve) => {
      const s = connect(url, {
        auth: { token },
        transports: ["websocket"],
        forceNew: true,
        reconnection: false,
        extraHeaders: origin ? { origin } : {},
      });
      s.on("connect", () => { s.disconnect(); resolve("connected"); });
      s.on("connect_error", (e) => { s.disconnect(); resolve(`refused: ${e.message}`); });
    });

  test("allowed origin with a valid token connects", async () => {
    const u = await createUser();
    expect(await tryConnect(u.token, ALLOWED)).toBe("connected");
  });

  test("a websocket from a non-allowed origin is refused, even with a valid token", async () => {
    const u = await createUser();
    expect(await tryConnect(u.token, "http://evil.example.com")).toMatch(/^refused/);
  });

  test("no Origin (native app) with a valid token connects; the JWT is still required", async () => {
    const u = await createUser();
    expect(await tryConnect(u.token, undefined)).toBe("connected");
    expect(await tryConnect("bad-token", undefined)).toBe("refused: UNAUTHORIZED");
  });
});

describe("startup configuration check", () => {
  const good = {
    MONGO_URI: "mongodb://127.0.0.1:27017",
    JWT_SECRET: "x".repeat(32),
    CORS_ORIGINS: "http://localhost:8081, https://app.example.com",
  };

  test("a valid environment has no errors and parses the allowlist", () => {
    const { errors, config } = loadConfig(good);
    expect(errors).toEqual([]);
    expect(config.corsOrigins).toEqual(["http://localhost:8081", "https://app.example.com"]);
    expect(config).toMatchObject({ port: 5001, authRateLimit: { max: 20, windowMs: 15 * 60 * 1000 }, trustProxy: false });
  });

  test("everything missing -> every problem listed at once", () => {
    expect(loadConfig({}).errors).toEqual([
      "MONGO_URI is not set",
      "JWT_SECRET is not set",
      'CORS_ORIGINS is not set (comma-separated origins, e.g. "http://localhost:8081")',
    ]);
  });

  test("JWT_SECRET under 32 characters -> error with its length, never its value", () => {
    const secret = "short-secret-16c";
    const { errors } = loadConfig({ ...good, JWT_SECRET: secret });
    expect(errors).toEqual(["JWT_SECRET must be at least 32 characters (it has 16)"]);
    expect(errors.join(" ")).not.toContain(secret);
    expect(loadConfig({ ...good, JWT_SECRET: "y".repeat(32) }).errors).toEqual([]);
  });

  test.each(["*", "http://x.com/", "http://x.com/app", "localhost:8081", "ftp://x.com", "exp://10.0.0.1:19000"])(
    "CORS_ORIGINS entry %p is rejected",
    (origin) => {
      const { errors } = loadConfig({ ...good, CORS_ORIGINS: `http://localhost:8081,${origin}` });
      expect(errors).toHaveLength(1);
      expect(errors[0]).toMatch(/^CORS_ORIGINS has invalid origins/);
    }
  );

  test.each([
    ["PORT", "abc"],
    ["AUTH_RATE_LIMIT_MAX", "0"],
    ["AUTH_RATE_LIMIT_WINDOW_MIN", "1.5"],
  ])("%s=%p -> error", (name, value) => {
    expect(loadConfig({ ...good, [name]: value }).errors).toEqual([`${name} must be a positive whole number`]);
  });

  test("the real server refuses to start with a bad config, before touching the database", () => {
    // Empty working directory, so dotenv can't load backend/.env; the
    // database address is unreachable anyway.
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "qe-env-"));
    let result;
    try {
      execFileSync(process.execPath, [path.join(__dirname, "../src/server.js")], {
        cwd,
        env: { PATH: process.env.PATH, MONGO_URI: "mongodb://127.0.0.1:1", JWT_SECRET: "too-short", CORS_ORIGINS: "*" },
        stdio: "pipe",
        timeout: 15000,
      });
      result = { status: 0, out: "" };
    } catch (e) {
      result = { status: e.status, out: `${e.stdout}${e.stderr}` };
    }
    expect(result.status).toBe(1);
    expect(result.out).toMatch(/Invalid configuration/);
    expect(result.out).toMatch(/JWT_SECRET must be at least 32 characters \(it has 9\)/);
    expect(result.out).toMatch(/CORS_ORIGINS has invalid origins: \*/);
    expect(result.out).not.toMatch(/Connecting to MongoDB/);
    expect(result.out).not.toContain("too-short");
  });
});
