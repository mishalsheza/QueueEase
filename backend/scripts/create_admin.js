/**
 * Creates an admin account, or promotes an existing account to admin.
 * This is the only way to get an admin besides the seed script: /register
 * always creates regular users.
 *
 * Usage (from backend/):
 *   ADMIN_PASSWORD='...' node scripts/create_admin.js --name "Jane Admin" --email jane@example.com
 *   node scripts/create_admin.js --email existing@example.com      # promote an existing user
 *
 * The password is read from ADMIN_PASSWORD rather than a flag so it doesn't
 * end up in shell history. Unlike seed_db.js, this never deletes data.
 */
const mongoose = require("mongoose");
const User = require("../src/models/User");

async function createAdmin({ name, email, password }) {
  if (!email) throw new Error("--email is required");

  const existing = await User.findOne({ email });
  if (existing) {
    if (existing.role === "admin") return { action: "unchanged", user: existing };
    // updateOne (not save) so the password hash is never touched.
    await User.updateOne({ _id: existing._id }, { $set: { role: "admin" } });
    return { action: "promoted", user: await User.findById(existing._id) };
  }

  if (!name) throw new Error("--name is required when creating a new admin");
  if (!password) throw new Error("ADMIN_PASSWORD env var is required when creating a new admin");

  const user = await User.create({ name, email, password, role: "admin" });
  return { action: "created", user };
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    if (!key.startsWith("--") || argv[i + 1] === undefined) {
      throw new Error(`Unexpected argument: ${key}`);
    }
    args[key.slice(2)] = argv[i + 1];
  }
  return args;
}

async function main() {
  // Loaded here, not at module top, so importing this file in tests never reads .env.
  require("dotenv").config({ quiet: true });
  const { name, email } = parseArgs(process.argv.slice(2));
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI is not set");

  await mongoose.connect(process.env.MONGO_URI, { dbName: "queueease" });
  try {
    const { action, user } = await createAdmin({ name, email, password: process.env.ADMIN_PASSWORD });
    console.log(`Admin ${action}: ${user.email} (${user._id})`);
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

module.exports = { createAdmin, parseArgs };
