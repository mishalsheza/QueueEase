// seed_db.js targets the same database as the server, only wipes a local
// database (or NODE_ENV=test) and only with --yes, clears tickets too, and
// doesn't print tokens.
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const User = require("../src/models/User");
const Queue = require("../src/models/Queue");
const Ticket = require("../src/models/Ticket");
const { DB_NAME } = require("../src/config/db");
const { seed, seedRefusal, isLocalUri, DEMO_PASSWORD } = require("../scripts/seed_db");
const db = require("./helpers/db");
const { createUser, createQueue } = require("./helpers/factories");

beforeAll(db.connect);
afterEach(db.clear);
afterAll(db.close);

test("seed replaces users, queues and tickets with the demo data", async () => {
  const old = await createUser();
  const q = await createQueue(old.user);
  await Ticket.create({ user: old.user._id, queue: q._id, queueName: q.name, token: "C-1", status: "waiting" });

  const { admin, user, queue } = await seed();

  expect(await User.countDocuments()).toBe(2);
  expect(await Queue.countDocuments()).toBe(1);
  expect(await Ticket.countDocuments()).toBe(0); // orphan tickets were left behind before
  expect(admin.role).toBe("admin");
  expect(user.role).toBe("user");
  expect(queue.admin.equals(admin._id)).toBe(true);
  expect(await (await User.findById(admin._id)).matchPassword(DEMO_PASSWORD)).toBe(true);
});

const SEED = path.join(__dirname, "../scripts/seed_db.js");
// Fake Atlas URI: the guard must refuse before any connection is attempted.
const ATLAS = "mongodb+srv://me:pw@cluster0.abc12.mongodb.net/?retryWrites=true";

/** Runs the real script and returns { status, stderr }. */
function runSeed(args, env) {
  try {
    execFileSync(process.execPath, [SEED, ...args], {
      env: { ...process.env, ...env },
      stdio: "pipe",
      timeout: 15000,
    });
    return { status: 0, stderr: "" };
  } catch (e) {
    return { status: e.status, stderr: String(e.stderr) };
  }
}

describe("seed_db only wipes a local database", () => {
  test("Atlas URI with --yes -> refuses with a clear message, before connecting", () => {
    const { status, stderr } = runSeed(["--yes"], { MONGO_URI: ATLAS, NODE_ENV: "development" });
    expect(status).toBe(1);
    expect(stderr).toMatch(/Refusing to seed/);
    expect(stderr).toMatch(/cluster0\.abc12\.mongodb\.net/);
    expect(stderr).toMatch(/localhost or 127\.0\.0\.1/);
    expect(stderr).not.toMatch(/me:pw/); // credentials are not echoed
  });

  test("local URI without --yes -> refuses", () => {
    // Port 1 is unreachable, so a broken guard would fail on connect instead.
    const { status, stderr } = runSeed([], { MONGO_URI: "mongodb://127.0.0.1:1", NODE_ENV: "development" });
    expect(status).toBe(1);
    expect(stderr).toMatch(/--yes/);
  });

  const yes = ["node", "seed_db.js", "--yes"];
  test.each([
    ["mongodb://localhost:27017", "development", true],
    ["mongodb://127.0.0.1:27017/queueease", undefined, true],
    ["mongodb://user:pw@localhost:27017,127.0.0.1:27018/?replicaSet=rs0", "development", true],
    [ATLAS, "development", false],
    [ATLAS, "production", false],
    [ATLAS, undefined, false],
    [ATLAS, "test", true],
    ["mongodb://db.example.com:27017", "development", false],
    ["mongodb://localhost:27017,db.example.com:27017", "development", false],
    ["mongodb://localhost.evil.com:27017", "development", false],
  ])("%s with NODE_ENV=%s and --yes -> allowed: %s", (uri, nodeEnv, allowed) => {
    expect(seedRefusal({ argv: yes, uri, nodeEnv }) === null).toBe(allowed);
  });

  test("--yes is still required for a local database or NODE_ENV=test", () => {
    const noYes = ["node", "seed_db.js"];
    expect(seedRefusal({ argv: noYes, uri: "mongodb://localhost", nodeEnv: "development" })).toMatch(/--yes/);
    expect(seedRefusal({ argv: noYes, uri: ATLAS, nodeEnv: "test" })).toMatch(/--yes/);
  });

  test("mongodb+srv is never treated as local", () => {
    expect(isLocalUri("mongodb+srv://localhost/x")).toBe(false);
  });
});

test.each(["seed_db.js", "check_db.js", "create_admin.js"])(
  "%s connects to the server's database, not the default 'test' one",
  (file) => {
    const src = fs.readFileSync(path.join(__dirname, "../scripts", file), "utf8");
    expect(DB_NAME).toBe("queueease");
    expect(src).toMatch(/dbName:\s*DB_NAME/);
    expect(src).not.toMatch(/console\.log\([^)]*[Tt]oken/);
  }
);
