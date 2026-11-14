// A6: seed_db.js targets the same database as the server, refuses to wipe
// data without --yes, clears tickets too, and doesn't print tokens.
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const User = require("../src/models/User");
const Queue = require("../src/models/Queue");
const Ticket = require("../src/models/Ticket");
const { DB_NAME } = require("../src/config/db");
const { seed, DEMO_PASSWORD } = require("../scripts/seed_db");
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

test("without --yes it refuses and exits before touching the database", () => {
  let err;
  try {
    execFileSync(process.execPath, [path.join(__dirname, "../scripts/seed_db.js")], {
      env: { ...process.env, MONGO_URI: "mongodb://127.0.0.1:1" }, // unreachable on purpose
      stdio: "pipe",
    });
  } catch (e) {
    err = e;
  }
  expect(err.status).toBe(1);
  expect(err.stderr.toString()).toMatch(/--yes/);
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
