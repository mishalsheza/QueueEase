/**
 * Resets the dev database to a small demo data set.
 *
 * DELETES all users, queues and tickets in the "queueease" database first, so
 * it only runs when BOTH are true:
 *   1. --yes is passed:  node scripts/seed_db.js --yes
 *   2. MONGO_URI points at this machine (every host is localhost or
 *      127.0.0.1), or NODE_ENV=test. A cloud database such as Atlas
 *      (mongodb+srv://...) is refused.
 * Both are checked before connecting.
 *
 * Demo logins (password "password123"):
 *   admin@example.com (admin), john@example.com (user)
 *
 * Tokens are no longer printed: log in through the app or POST /api/auth/login.
 */
const mongoose = require("mongoose");
const User = require("../src/models/User");
const Queue = require("../src/models/Queue");
const Ticket = require("../src/models/Ticket");
const { DB_NAME } = require("../src/config/db");

const DEMO_PASSWORD = "password123";

async function seed() {
  await Promise.all([User.deleteMany({}), Queue.deleteMany({}), Ticket.deleteMany({})]);

  const admin = await User.create({ name: "Admin User", email: "admin@example.com", password: DEMO_PASSWORD, role: "admin" });
  const user = await User.create({ name: "John Doe", email: "john@example.com", password: DEMO_PASSWORD, role: "user" });
  const queue = await Queue.create({ name: "Dr. Smith Clinic", admin: admin._id });

  return { admin, user, queue };
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);

/** Hostnames in a MongoDB connection string, without credentials or ports. */
function uriHosts(uri) {
  const m = /^mongodb(\+srv)?:\/\/(?:[^@/]*@)?([^/?]*)/.exec(uri || "");
  if (!m) return { srv: false, hosts: [] };
  const hosts = m[2]
    .split(",")
    .map((h) => h.replace(/:\d+$/, "").toLowerCase())
    .filter(Boolean);
  return { srv: Boolean(m[1]), hosts };
}

function isLocalUri(uri) {
  const { srv, hosts } = uriHosts(uri);
  return !srv && hosts.length > 0 && hosts.every((h) => LOCAL_HOSTS.has(h));
}

/** Returns null if seeding may run, otherwise the reason it may not. */
function seedRefusal({ argv, uri, nodeEnv }) {
  if (!uri) return "MONGO_URI is not set.";
  if (!argv.includes("--yes")) {
    return `This deletes all users, queues and tickets in "${DB_NAME}". Re-run with --yes to continue.`;
  }
  if (!isLocalUri(uri) && nodeEnv !== "test") {
    const where = uriHosts(uri).hosts.join(", ") || "an unrecognised host";
    return (
      `Refusing to seed: MONGO_URI points at ${where}, not this machine. ` +
      "seed_db only wipes a local database (localhost or 127.0.0.1 in MONGO_URI) or runs with NODE_ENV=test. " +
      "Point MONGO_URI at a local MongoDB to seed it."
    );
  }
  return null;
}

async function main() {
  require("dotenv").config({ quiet: true });
  const refusal = seedRefusal({ argv: process.argv, uri: process.env.MONGO_URI, nodeEnv: process.env.NODE_ENV });
  if (refusal) {
    console.error(refusal);
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI, { dbName: DB_NAME });
  try {
    const { admin, user, queue } = await seed();
    console.log(`Seeded "${DB_NAME}":`);
    console.log(`  admin: ${admin.email}`);
    console.log(`  user:  ${user.email}`);
    console.log(`  queue: ${queue.name} (${queue._id})`);
    console.log(`  password for both: ${DEMO_PASSWORD}`);
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  });
}

module.exports = { seed, seedRefusal, isLocalUri, DEMO_PASSWORD };
