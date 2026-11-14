/**
 * Resets the dev database to a small demo data set.
 *
 * DELETES all users, queues and tickets in the "queueease" database first, so
 * it refuses to run without --yes:
 *   node scripts/seed_db.js --yes
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

async function main() {
  if (!process.argv.includes("--yes")) {
    console.error(`This deletes all users, queues and tickets in "${DB_NAME}". Re-run with --yes to continue.`);
    process.exit(1);
  }
  require("dotenv").config({ quiet: true });
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI is not set");

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

module.exports = { seed, DEMO_PASSWORD };
